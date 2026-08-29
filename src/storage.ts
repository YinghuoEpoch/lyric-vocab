import localforage from 'localforage'
import type {
  Annotation,
  AnnotationGroup,
  AnnotationType,
  AppData,
  LyricBook,
  LyricPage,
  NotesMap,
  Sentence,
  WordNote
} from './types'
import { annotationGroupOf } from './types'
import { migrateToAnnotations, type MigrationReport } from './utils/migrateAnnotations'
import { insertionOrder } from './utils/annotationOrder'
import {
  SAMPLE_BOOK_ID,
  SAMPLE_PAGE_ID,
  YESTERDAY_ONCE_MORE,
  SAMPLE_NOTES,
  SAMPLE_SENTENCES
} from './sampleData'

export const STORAGE_KEY = 'lyric-vocab-data'
const KEY = STORAGE_KEY

/**
 * 存储层。
 *
 * 这里只有「一份」权威数据：内存里的 cache。
 * 所有修改都直接改 cache（同步、立刻生效），落盘则攒一下再批量写。
 *
 * 之前的做法是每个操作各自「读整个库 → 改 → 写整个库」，因为读写都是异步的，
 * 两个操作在时间上重叠时，后写的会把先写的整个覆盖掉 —— 比如滚动进度的延迟保存
 * 正好赶上你存一条笔记，笔记就没了。这种丢失是偶发的、复现不了的。
 * 现在所有操作共享同一个 cache 对象，不存在互相覆盖；落盘也排成一条队，不会并发。
 *
 * 另外每个修改都会沿着被改动的路径生成新对象（而不是原地改），
 * 这样 React 才能正确察觉变化并重新渲染。
 */

/** 攒多久再落盘。够短，短到用户几乎不可能在这段时间内杀掉 App */
const SAVE_DEBOUNCE_MS = 400

/** 内存中的权威数据；null 表示尚未从 IndexedDB 载入 */
let cache: AppData | null = null
/** 载入过程只做一次 */
let loadPromise: Promise<AppData> | null = null
/** 待落盘的定时器 */
let saveTimer: ReturnType<typeof setTimeout> | null = null
/** 落盘队列：保证任何时刻只有一个写操作在跑，且按顺序 */
let writeChain: Promise<void> = Promise.resolve()

/** 从 localStorage 迁移历史数据（只在 IndexedDB 尚无数据时执行一次） */
async function migrateLegacyData(): Promise<AppData | null> {
  try {
    const legacyRaw = localStorage.getItem(KEY)
    if (!legacyRaw) return null
    const legacyData = JSON.parse(legacyRaw) as AppData
    await localforage.setItem(KEY, legacyData)
    localStorage.removeItem(KEY)
    return legacyData
  } catch {
    return null
  }
}

/** 确保 cache 已载入，并返回它。并发调用只会真正载入一次。 */
function ensureLoaded(): Promise<AppData> {
  if (cache) return Promise.resolve(cache)
  if (!loadPromise) {
    loadPromise = (async () => {
      let data: AppData | null = null
      try {
        data = await localforage.getItem<AppData>(KEY)
        if (!data) data = await migrateLegacyData()
      } catch {
        data = null
      }

      if (!data) {
        // 真·首次启动（存储里什么都没有）：放一份示例内容
        cache = makeSampleData()
        await flush()
        return cache
      }

      cache = {
        books: data.books ?? [],
        pages: data.pages ?? [],
        notes: data.notes ?? {},
        annotations: data.annotations ?? [],
        annotationsMigratedAt: data.annotationsMigratedAt
      }
      return cache
    })()
  }
  return loadPromise
}

/** 立刻把内存数据写入 IndexedDB（排队执行，不会并发） */
export function flush(): Promise<void> {
  if (saveTimer) {
    clearTimeout(saveTimer)
    saveTimer = null
  }
  const snapshot = cache
  if (!snapshot) return writeChain
  writeChain = writeChain
    .then(() => localforage.setItem(KEY, snapshot))
    .then(() => undefined)
    .catch(() => undefined) // 单次写失败不应该卡死后续所有写入
  return writeChain
}

/** 安排一次延迟落盘（重复调用只会重置计时器） */
function scheduleSave(): void {
  if (saveTimer) clearTimeout(saveTimer)
  saveTimer = setTimeout(() => {
    saveTimer = null
    void flush()
  }, SAVE_DEBOUNCE_MS)
}

// App 退到后台 / 页面关闭时，立刻把还没落盘的改动写下去。
// 这是「攒一下再写」唯一的风险窗口，这两个事件把它堵上。
if (typeof document !== 'undefined') {
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'hidden') void flush()
  })
}
if (typeof window !== 'undefined') {
  window.addEventListener('pagehide', () => void flush())
}

/**
 * 返回一个新的顶层对象，让 React 认出「数据变了」。
 * 内层的 books / pages / notes 由各个修改函数按需替换。
 */
function snapshot(data: AppData): AppData {
  return {
    books: data.books,
    pages: data.pages,
    notes: data.notes,
    annotations: data.annotations,
    annotationsMigratedAt: data.annotationsMigratedAt
  }
}

/** 改完之后统一走这里：安排落盘 + 返回可直接塞进 React state 的快照 */
function commit(data: AppData): AppData {
  scheduleSave()
  return snapshot(data)
}

/**
 * 首次启动时的示例内容。
 *
 * 注意：只在存储里「一条记录都没有」时才用。原来的判断是「books 为空就补示例」，
 * 结果是用户把文库全删光之后，示例又会自己冒出来 —— 现在删掉就是删掉了。
 */
function makeSampleData(): AppData {
  const now = Date.now()
  const books = [{ id: SAMPLE_BOOK_ID, name: '示例文库', createdAt: now }]
  const pages = [
    {
      id: SAMPLE_PAGE_ID,
      bookId: SAMPLE_BOOK_ID,
      title: 'Wish My Life Away',
      content: YESTERDAY_ONCE_MORE,
      updatedAt: now
    }
  ]
  const notes = { [SAMPLE_PAGE_ID]: { ...SAMPLE_NOTES } }

  // 示例内容仍以旧形状写在 sampleData.ts 里（那份文件本身就是给人读的），
  // 这里过一遍迁移器转成标注 —— 新装的 App 因此不必再跑一次启动迁移。
  const { annotations } = migrateToAnnotations(
    { pages, notes, sentences: SAMPLE_SENTENCES },
    { makeId: generateId, now }
  )

  return { books, pages, notes, annotations, annotationsMigratedAt: now }
}

/**
 * 读取当前数据。
 * 首次调用会从 IndexedDB 载入，之后都直接返回内存里的那一份 —— 不再碰磁盘。
 */
export async function getAppData(): Promise<AppData> {
  const data = await ensureLoaded()
  return snapshot(data)
}

/** 用外部数据（如恢复备份）整体替换当前数据 */
export async function replaceAllData(next: AppData): Promise<AppData> {
  const data = await ensureLoaded()
  data.books = next.books ?? []
  data.pages = next.pages ?? []
  data.notes = next.notes ?? {}
  // 恢复的备份可能是迁移之前导出的（里面只有旧的 notes / sentences）。
  // 那种情况下把「迁移过」的标记一并清掉，让迁移重新跑一遍，
  // 否则恢复回来的笔记会一条都不出现在新模型里。
  data.annotations = next.annotations ?? []
  // 备份里已经带着标注表，就一定要打上「迁移过」的标记 —— 否则启动迁移会拿
  // 备份里的旧 notes 重建整张表，把恢复回来的标注覆盖掉。
  data.annotationsMigratedAt = next.annotations?.length
    ? (next.annotationsMigratedAt ?? Date.now())
    : undefined
  await flush()
  return snapshot(data)
}

export async function saveBook(book: LyricBook): Promise<AppData> {
  const data = await ensureLoaded()
  const idx = data.books.findIndex((b) => b.id === book.id)
  data.books = idx >= 0
    ? data.books.map((b, i) => (i === idx ? book : b))
    : [...data.books, book]
  return commit(data)
}

/** 软删除：设置 deletedAt，不从数组移除 */
export async function moveBookToTrash(bookId: string): Promise<AppData> {
  const data = await ensureLoaded()
  const deletedAt = Date.now()
  data.books = data.books.map((b) => (b.id === bookId ? { ...b, deletedAt } : b))
  data.pages = data.pages.map((p) => (p.bookId === bookId ? { ...p, deletedAt } : p))
  return commit(data)
}

/** 软删除：设置 deletedAt */
export async function movePageToTrash(pageId: string): Promise<AppData> {
  const data = await ensureLoaded()
  const deletedAt = Date.now()
  data.pages = data.pages.map((p) => (p.id === pageId ? { ...p, deletedAt } : p))
  return commit(data)
}

/** 恢复文库及其下属文档 */
export async function restoreBook(bookId: string): Promise<AppData> {
  const data = await ensureLoaded()
  data.books = data.books.map((b) => {
    if (b.id !== bookId) return b
    const { deletedAt: _removed, ...rest } = b
    return rest
  })
  data.pages = data.pages.map((p) => {
    if (p.bookId !== bookId) return p
    const { deletedAt: _removed, ...rest } = p
    return rest
  })
  return commit(data)
}

/** 恢复文档 */
export async function restorePage(pageId: string): Promise<AppData> {
  const data = await ensureLoaded()
  data.pages = data.pages.map((p) => {
    if (p.id !== pageId) return p
    const { deletedAt: _removed, ...rest } = p
    // 如果原父文库已不存在或仍在回收站，则把文档提升到根级
    const parent = data.books.find((b) => b.id === rest.bookId && !b.deletedAt)
    return parent ? rest : { ...rest, bookId: null }
  })
  return commit(data)
}

/** 物理删除文库：其下文档「溶解」到根级，而不是一起删掉 */
export async function deleteBookPermanently(bookId: string): Promise<AppData> {
  const data = await ensureLoaded()
  data.pages = data.pages.map((p) => (p.bookId === bookId ? { ...p, bookId: null } : p))
  data.books = data.books.filter((b) => b.id !== bookId)
  return commit(data)
}

/** 物理删除文档 */
export async function deletePagePermanently(pageId: string): Promise<AppData> {
  const data = await ensureLoaded()
  data.pages = data.pages.filter((p) => p.id !== pageId)
  if (data.notes[pageId]) {
    const { [pageId]: _removed, ...rest } = data.notes
    data.notes = rest
  }
  const annotations = data.annotations ?? []
  if (annotations.some((a) => a.docId === pageId)) {
    data.annotations = annotations.filter((a) => a.docId !== pageId)
  }
  return commit(data)
}

export async function savePage(page: LyricPage): Promise<AppData> {
  const data = await ensureLoaded()
  const next = { ...page, updatedAt: Date.now() }
  const idx = data.pages.findIndex((p) => p.id === page.id)
  data.pages = idx >= 0
    ? data.pages.map((p, i) => (i === idx ? next : p))
    : [...data.pages, next]
  return commit(data)
}

/*
 * ============================================================
 * 旧模型（notes）的写入接口 —— App 里已经没人调用了。
 *
 * 界面已全部改走标注表。这几个函数连同 data.notes 一起留着，
 * 是「跑稳之前不删旧数据」这条安全网的一部分：
 * 万一新模型出问题，旧数据和读写它的代码都还在。
 * 等新版本在真机上用一阵子、确认无误，再连同 data.notes 一起清掉。
 *
 * 例外：replacePageNotes 还在用 —— 分词迁移（migrateTokenizer）
 * 修的是旧形状的数据，得靠它写回去。
 * ============================================================
 */

export async function saveNoteForPage(
  pageId: string,
  anchorId: string,
  note: WordNote
): Promise<AppData> {
  const data = await ensureLoaded()
  data.notes = { ...data.notes, [pageId]: { ...(data.notes[pageId] ?? {}), [anchorId]: note } }
  return commit(data)
}

/**
 * 整体替换某篇文档的全部单词笔记。
 * 用于正文编辑后的「对账」：一次性把所有笔记搬到新坐标上，
 * 逐条改的话中间状态会出现两条笔记抢同一个坐标。
 */
export async function replacePageNotes(pageId: string, nextNotes: NotesMap): Promise<AppData> {
  const data = await ensureLoaded()
  if (Object.keys(nextNotes).length === 0) {
    const { [pageId]: _removed, ...rest } = data.notes
    data.notes = rest
  } else {
    data.notes = { ...data.notes, [pageId]: nextNotes }
  }
  return commit(data)
}

export async function deleteNoteForPage(pageId: string, anchorId: string): Promise<AppData> {
  const data = await ensureLoaded()
  const pageNotes = data.notes[pageId]
  if (!pageNotes || !(anchorId in pageNotes)) return snapshot(data)

  const { [anchorId]: _removed, ...restNotes } = pageNotes
  if (Object.keys(restNotes).length === 0) {
    const { [pageId]: _emptied, ...restPages } = data.notes
    data.notes = restPages
  } else {
    data.notes = { ...data.notes, [pageId]: restNotes }
  }
  return commit(data)
}

/**
 * 按单词拼写（不区分大小写）更新所有文档中的对应生词。
 * 不修改 word 本身，只更新传入的字段（如 pos / definition 等）。
 * 这是用户的手动编辑，因此会清掉「AI 填充」标记。
 */
export async function updateWordEverywhere(
  spelling: string,
  updates: Partial<WordNote>
): Promise<AppData> {
  const data = await ensureLoaded()
  const target = spelling.trim().toLowerCase()
  if (!target) return snapshot(data)

  const { word: _ignored, ...rest } = updates
  if (Object.keys(rest).length === 0) return snapshot(data)

  const nextNotes: AppData['notes'] = {}
  let changed = false

  for (const pageId of Object.keys(data.notes)) {
    const map = data.notes[pageId]
    let pageChanged = false
    const nextMap: NotesMap = {}

    for (const anchorId of Object.keys(map)) {
      const note = map[anchorId]
      if (note?.word && note.word.trim().toLowerCase() === target) {
        // 这个函数只在用户手动编辑生词卡时调用，所以顺带清掉「AI 填充」标记
        const { auto: _wasAuto, ...kept } = note
        nextMap[anchorId] = { ...kept, ...rest }
        pageChanged = true
      } else {
        nextMap[anchorId] = note
      }
    }

    nextNotes[pageId] = pageChanged ? nextMap : map
    if (pageChanged) changed = true
  }

  if (!changed) return snapshot(data)
  data.notes = nextNotes
  return commit(data)
}

/**
 * 重新排序文库。
 * bookOrder 只需包含活动文库的顺序，未提及的（例如回收站里的）按原顺序追加在后面。
 */
export async function reorderBooks(bookOrder: string[]): Promise<AppData> {
  const data = await ensureLoaded()
  const map = new Map(data.books.map((b) => [b.id, b]))
  const ordered: LyricBook[] = []

  for (const id of bookOrder) {
    const book = map.get(id)
    if (book) {
      ordered.push(book)
      map.delete(id)
    }
  }
  for (const book of data.books) {
    if (map.has(book.id)) {
      ordered.push(book)
      map.delete(book.id)
    }
  }

  data.books = ordered
  return commit(data)
}

/**
 * 重新排序文档，同时支持跨文库移动。
 * 未出现在 entries 中的文档保持原相对顺序并追加在后面。
 */
export async function reorderPages(
  entries: Array<{ id: string; bookId: string | null }>
): Promise<AppData> {
  const data = await ensureLoaded()
  const map = new Map(data.pages.map((p) => [p.id, p]))
  const ordered: LyricPage[] = []

  for (const { id, bookId } of entries) {
    const page = map.get(id)
    if (page) {
      ordered.push(page.bookId === bookId ? page : { ...page, bookId })
      map.delete(id)
    }
  }
  for (const page of data.pages) {
    if (map.has(page.id)) {
      ordered.push(page)
      map.delete(page.id)
    }
  }

  data.pages = ordered
  return commit(data)
}

/**
 * 批量创建一个文库及其下属文档（用于导入 txt）。
 * 返回新建文库的 ID 与更新后的数据。
 */
export async function addBookWithPages(
  bookName: string,
  chapters: Array<{ title: string; content: string }>
): Promise<{ bookId: string; data: AppData }> {
  const data = await ensureLoaded()
  const now = Date.now()
  const bookId = generateId()

  data.books = [...data.books, { id: bookId, name: bookName || '导入文库', createdAt: now }]
  data.pages = [
    ...data.pages,
    ...chapters.map((chapter) => ({
      id: generateId(),
      bookId,
      title: chapter.title?.trim() || '未命名章节',
      content: chapter.content ?? '',
      updatedAt: now
    }))
  ]

  return { bookId, data: commit(data) }
}

// ============================================================
// 标注（新模型）
//
// 与上面的 notes / 句摘并存。这一段目前还没有被界面调用 ——
// 先把地基砌好、测好，等对账和界面都切过来了，旧的那两套才退休。
// ============================================================

/**
 * 取出某篇文档的标注，按 order 排好。
 *
 * 纯读取，不碰存储，所以可以在渲染里直接用。
 * 排序只在「同一文档、同一类型」内比较，这也是 order 的定义。
 */
export function selectAnnotations(
  data: AppData,
  docId: string,
  type?: AnnotationType
): Annotation[] {
  const all = data.annotations ?? []
  return all
    .filter((a) => a.docId === docId && (type === undefined || a.type === type))
    .sort((a, b) => a.order - b.order)
}

/** 排在同文档同组的最后。用于兜底和迁移；新建标注请用 orderForNewAnnotation */
export function nextAnnotationOrder(data: AppData, docId: string, group: AnnotationGroup): number {
  let max = -1
  for (const a of data.annotations ?? []) {
    if (a.docId === docId && annotationGroupOf(a.type) === group && a.order > max) max = a.order
  }
  return max + 1
}

/**
 * 新建标注时该给的 order：**按正文顺序插进去**，排在正文里紧挨着它前面那条的后面。
 *
 * 从前一律排最后，于是 `apple and ear` 里后标的 and 会跑到卡片列表末尾。
 * 算法在 utils/annotationOrder.ts（纯函数、有单测），这里只负责挑出同文档同组的那批。
 * 「同组」而不是「同类型」：单词和短语共用一列卡片，必须排在同一条队里。
 */
export function orderForNewAnnotation(
  data: AppData,
  docId: string,
  group: AnnotationGroup,
  start: string | null
): number {
  const siblings = (data.annotations ?? []).filter(
    (a) => a.docId === docId && annotationGroupOf(a.type) === group
  )
  return insertionOrder(siblings, start)
}

/** 新增或更新一条标注（按 id 认人） */
export async function saveAnnotation(annotation: Annotation): Promise<AppData> {
  const data = await ensureLoaded()
  const all = data.annotations ?? []
  const idx = all.findIndex((a) => a.id === annotation.id)
  data.annotations = idx >= 0
    ? all.map((a, i) => (i === idx ? annotation : a))
    : [...all, annotation]
  return commit(data)
}

/** 按 id 删除一条标注 */
export async function deleteAnnotation(id: string): Promise<AppData> {
  const data = await ensureLoaded()
  const all = data.annotations ?? []
  if (!all.some((a) => a.id === id)) return snapshot(data)
  data.annotations = all.filter((a) => a.id !== id)
  return commit(data)
}

/**
 * 整体替换某篇文档的全部标注。
 *
 * 给对账用：正文编辑之后，一批标注的位置要同时更新。
 * 逐条改会出现「中间状态」，一半新一半旧，界面上会闪出错位的一帧。
 */
export async function replaceDocAnnotations(
  docId: string,
  next: Annotation[]
): Promise<AppData> {
  const data = await ensureLoaded()
  const others = (data.annotations ?? []).filter((a) => a.docId !== docId)
  data.annotations = [...others, ...next]
  return commit(data)
}

/**
 * 按拼写（不区分大小写）更新所有文档里的同一个词。
 *
 * 对应旧的 updateWordEverywhere：你在生词卡上改了「stood」的释义，
 * 全库其它文档里的 stood 一起跟着改。
 * 这是用户的手动编辑，所以顺手清掉「AI 填充」标记。
 */
export async function updateAnnotationsByWord(
  spelling: string,
  updates: Partial<Omit<Annotation, 'id' | 'docId' | 'type' | 'start' | 'end' | 'text' | 'order'>>
): Promise<AppData> {
  const data = await ensureLoaded()
  const target = spelling.trim().toLowerCase()
  if (!target) return snapshot(data)
  if (Object.keys(updates).length === 0) return snapshot(data)

  let changed = false
  const next = (data.annotations ?? []).map((a) => {
    if (a.type !== 'word' || a.text.trim().toLowerCase() !== target) return a
    changed = true
    const { auto: _wasAuto, ...kept } = a
    return { ...kept, ...updates }
  })

  if (!changed) return snapshot(data)
  data.annotations = next
  return commit(data)
}

/**
 * 重排某篇文档某一组的标注（词汇 = 单词 + 短语，或句子）。
 * ids 里没提到的保持原有相对顺序，排在后面。
 */
export async function reorderAnnotations(
  docId: string,
  group: AnnotationGroup,
  ids: string[]
): Promise<AppData> {
  const data = await ensureLoaded()
  const rank = new Map(ids.map((id, i) => [id, i]))
  const inScope = (a: Annotation) => a.docId === docId && annotationGroupOf(a.type) === group

  // 没被提到的接在后面：先按原 order 排，再依次编号
  const rest = (data.annotations ?? [])
    .filter((a) => inScope(a) && !rank.has(a.id))
    .sort((a, b) => a.order - b.order)
  rest.forEach((a, i) => rank.set(a.id, ids.length + i))

  let changed = false
  const next = (data.annotations ?? []).map((a) => {
    if (!inScope(a)) return a
    const order = rank.get(a.id)
    if (order === undefined || order === a.order) return a
    changed = true
    return { ...a, order }
  })

  if (!changed) return snapshot(data)
  data.annotations = next
  return commit(data)
}

/**
 * 一次性迁移：把旧的 notes + 句摘转成标注表。
 *
 * 只跑一次，靠数据里的 annotationsMigratedAt 守住 —— 不是 localStorage。
 * 两者的区别很要命：localStorage 被清掉之后迁移会重跑，而重跑是拿「旧的 notes」
 * 重建整张表，等于把迁移之后新加的标注全部冲掉。标记跟数据存在一起就不会脱节。
 *
 * 旧的 notes 与句摘**不删**，原样留着当保险，等新模型在真机上跑稳了再清理。
 *
 * @param sentences 句摘。它住在 localStorage 里，不归存储层管，由调用方读好传进来。
 * @returns report 为 null 表示这次没跑（已经迁移过了）
 */
export async function runAnnotationMigration(
  sentences: Sentence[]
): Promise<{ data: AppData; report: MigrationReport | null }> {
  const data = await ensureLoaded()
  if (data.annotationsMigratedAt) return { data: snapshot(data), report: null }

  const { annotations, report } = migrateToAnnotations(
    { pages: data.pages, notes: data.notes, sentences },
    { makeId: generateId }
  )

  data.annotations = annotations
  data.annotationsMigratedAt = Date.now()
  await flush() // 迁移这种一次性的大动作立刻落盘，不进攒批队列
  return { data: snapshot(data), report }
}

export function generateId(): string {
  return Math.random().toString(36).slice(2, 12)
}
