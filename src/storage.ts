import localforage from 'localforage'
import type { AppData, LyricBook, LyricPage, NotesMap, WordNote } from './types'
import { SAMPLE_BOOK_ID, SAMPLE_PAGE_ID, YESTERDAY_ONCE_MORE, SAMPLE_NOTES } from './sampleData'

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
        notes: data.notes ?? {}
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
  return { books: data.books, pages: data.pages, notes: data.notes }
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
  return {
    books: [{ id: SAMPLE_BOOK_ID, name: '示例文库', createdAt: now }],
    pages: [
      {
        id: SAMPLE_PAGE_ID,
        bookId: SAMPLE_BOOK_ID,
        title: 'Wish My Life Away',
        content: YESTERDAY_ONCE_MORE,
        updatedAt: now
      }
    ],
    notes: { [SAMPLE_PAGE_ID]: { ...SAMPLE_NOTES } }
  }
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

export function generateId(): string {
  return Math.random().toString(36).slice(2, 12)
}
