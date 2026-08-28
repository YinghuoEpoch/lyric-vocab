import localforage from 'localforage'
import type { AppData, LyricBook, LyricPage, NotesMap, WordNote } from './types'
import { SAMPLE_BOOK_ID, SAMPLE_PAGE_ID, YESTERDAY_ONCE_MORE, SAMPLE_NOTES } from './sampleData'

export const STORAGE_KEY = 'lyric-vocab-data'
const KEY = STORAGE_KEY

const defaultData: AppData = {
  books: [],
  pages: [],
  notes: {}
}

let initPromise: Promise<void> | null = null

async function ensureInitialized(): Promise<void> {
  if (!initPromise) {
    initPromise = (async () => {
      try {
        // 如果 IndexedDB 中已经有数据，则不再从 localStorage 迁移
        const existing = await localforage.getItem<AppData>(KEY)
        if (existing) return

        const legacyRaw = localStorage.getItem(KEY)
        if (!legacyRaw) return

        const legacyData = JSON.parse(legacyRaw) as AppData
        await localforage.setItem(KEY, legacyData)
        localStorage.removeItem(KEY)
      } catch {
        // 忽略迁移错误，后续操作会按默认空数据继续
      }
    })()
  }
  return initPromise
}

async function load(): Promise<AppData> {
  try {
    await ensureInitialized()
    const data = (await localforage.getItem<AppData>(KEY)) ?? defaultData
    return {
      books: data.books ?? [],
      pages: data.pages ?? [],
      notes: data.notes ?? {}
    }
  } catch {
    return defaultData
  }
}

async function save(data: AppData): Promise<void> {
  await ensureInitialized()
  await localforage.setItem(KEY, data)
}

async function seedSample(): Promise<AppData> {
  const now = Date.now()
  const data: AppData = {
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
  await save(data)
  return data
}

export async function getAppData(): Promise<AppData> {
  const data = await load()
  if (data.books.length === 0) return seedSample()
  return data
}

export async function saveBook(book: LyricBook): Promise<void> {
  const data = await load()
  const idx = data.books.findIndex((b) => b.id === book.id)
  if (idx >= 0) data.books[idx] = book
  else data.books.push(book)
  await save(data)
}

/** 软删除：设置 deletedAt，不从数组移除 */
export async function moveBookToTrash(bookId: string): Promise<void> {
  const data = await load()
  const book = data.books.find((b) => b.id === bookId)
  if (book) {
    book.deletedAt = Date.now()
    data.pages.filter((p) => p.bookId === bookId).forEach((p) => { p.deletedAt = book.deletedAt })
  }
  await save(data)
}

/** 软删除：设置 deletedAt */
export async function movePageToTrash(pageId: string): Promise<void> {
  const data = await load()
  const page = data.pages.find((p) => p.id === pageId)
  if (page) page.deletedAt = Date.now()
  await save(data)
}

/** 恢复文库及其下属文档 */
export async function restoreBook(bookId: string): Promise<void> {
  const data = await load()
  const book = data.books.find((b) => b.id === bookId)
  if (book) {
    delete book.deletedAt
    data.pages.filter((p) => p.bookId === bookId).forEach((p) => delete p.deletedAt)
  }
  await save(data)
}

/** 恢复文档 */
export async function restorePage(pageId: string): Promise<void> {
  const data = await load()
  const page = data.pages.find((p) => p.id === pageId)
  if (page) {
    delete page.deletedAt
    // 如果原父文库已不存在或仍在回收站，则将文档提升到根级（bookId = null）
    const parent = data.books.find((b) => b.id === page.bookId && !b.deletedAt)
    if (!parent) {
      page.bookId = null
    }
  }
  await save(data)
}

/** 物理删除文库（从数组移除） */
export async function deleteBookPermanently(bookId: string): Promise<void> {
  const data = await load()
  // 先将该文库下的所有文档「溶解」到根级，而不是删除它们
  for (const page of data.pages) {
    if (page.bookId === bookId) {
      page.bookId = null
    }
  }
  // 再彻底删除文库本身
  data.books = data.books.filter((b) => b.id !== bookId)
  await save(data)
}

/** 物理删除文档 */
export async function deletePagePermanently(pageId: string): Promise<void> {
  const data = await load()
  data.pages = data.pages.filter((p) => p.id !== pageId)
  delete data.notes[pageId]
  await save(data)
}

/** @deprecated 使用 moveBookToTrash */
export async function deleteBook(bookId: string): Promise<void> {
  await moveBookToTrash(bookId)
}

export async function savePage(page: LyricPage): Promise<void> {
  const data = await load()
  page.updatedAt = Date.now()
  const idx = data.pages.findIndex((p) => p.id === page.id)
  if (idx >= 0) data.pages[idx] = page
  else data.pages.push(page)
  await save(data)
}

/** @deprecated 使用 movePageToTrash */
export async function deletePage(pageId: string): Promise<void> {
  await movePageToTrash(pageId)
}

export async function getNotesForPage(pageId: string): Promise<NotesMap> {
  const data = await load()
  return data.notes[pageId] ?? {}
}

export async function saveNoteForPage(pageId: string, anchorId: string, note: NotesMap[string]): Promise<void> {
  const data = await load()
  if (!data.notes[pageId]) data.notes[pageId] = {}
  data.notes[pageId][anchorId] = note
  await save(data)
}

export async function deleteNoteForPage(pageId: string, anchorId: string): Promise<void> {
  const data = await load()
  if (data.notes[pageId]) {
    delete data.notes[pageId][anchorId]
    if (Object.keys(data.notes[pageId]).length === 0) delete data.notes[pageId]
  }
  await save(data)
}

export async function getAllNotes(): Promise<
  Array<{ pageId: string; anchorId: string; word: string; note: NotesMap[string] }>
> {
  const data = await load()
  const out: Array<{ pageId: string; anchorId: string; word: string; note: NotesMap[string] }> = []
  for (const pageId of Object.keys(data.notes)) {
    const map = data.notes[pageId]
    for (const anchorId of Object.keys(map)) {
      const note = map[anchorId]
      if (note?.word) out.push({ pageId, anchorId, word: note.word, note })
    }
  }
  return out
}

/**
 * 按单词拼写（不区分大小写）更新所有文档中的对应生词。
 * - 不修改 word 本身，只更新传入的字段（如 pos / definition 等）。
 */
export async function updateWordEverywhere(spelling: string, updates: Partial<WordNote>): Promise<void> {
  const data = await load()
  const target = spelling.trim().toLowerCase()
  if (!target) return

  const { word: _ignored, ...rest } = updates
  const hasUpdates = Object.keys(rest).length > 0
  if (!hasUpdates) return

  for (const pageId of Object.keys(data.notes)) {
    const map = data.notes[pageId]
    for (const anchorId of Object.keys(map)) {
      const note = map[anchorId]
      if (!note?.word) continue
      if (note.word.trim().toLowerCase() !== target) continue
      data.notes[pageId][anchorId] = { ...note, ...rest }
    }
  }

  await save(data)
}

/**
 * 重新排序文库（books）的顺序。
 * - bookOrder 只需要包含“活动文库”的顺序，其余未提及的文库（例如已删除或未来扩展）会按原顺序追加在后面。
 */
export function reorderBooks(bookOrder: string[]): void {
  // 由于排序通常是批量操作，保持同步签名，内部使用异步保存以兼容调用方
  void (async () => {
    const data = await load()
  const map = new Map(data.books.map((b) => [b.id, b]))
  const ordered: LyricBook[] = []

  for (const id of bookOrder) {
    const book = map.get(id)
    if (book) {
      ordered.push(book)
      map.delete(id)
    }
  }

  // 其余未出现在 bookOrder 中的文库保持原相对顺序
  for (const book of data.books) {
    if (map.has(book.id)) {
      ordered.push(book)
      map.delete(book.id)
    }
  }

    data.books = ordered
    await save(data)
  })()
}

/**
 * 重新排序文档（pages），同时支持跨文库移动。
 * - entries 中每一项指定一个 page 的 id 及其新的 bookId 与顺序。
 * - 未出现在 entries 中的文档保持原相对顺序并追加在后面。
 */
export function reorderPages(
  entries: Array<{
    id: string
    bookId: string | null
  }>
): void {
  void (async () => {
    const data = await load()
    const map = new Map(data.pages.map((p) => [p.id, p]))
    const ordered: LyricPage[] = []

    for (const { id, bookId } of entries) {
      const page = map.get(id)
      if (page) {
        page.bookId = bookId
        ordered.push(page)
        map.delete(id)
      }
    }

    // 其余未出现在 entries 中的文档保持原相对顺序
    for (const page of data.pages) {
      if (map.has(page.id)) {
        ordered.push(page)
        map.delete(page.id)
      }
    }

    data.pages = ordered
    await save(data)
  })()
}

/**
 * 批量创建一个文库及其下属文档。
 * - bookName: 文库名称（通常来自文件名）
 * - chapters: 每一项为一个文档（章节），包含标题与正文内容
 * 返回新建文库的 ID。
 */
export function addBookWithPages(
  bookName: string,
  chapters: Array<{ title: string; content: string }>
): Promise<string> {
  return (async () => {
    const data = await load()
  const now = Date.now()

  const bookId = generateId()
  const book: LyricBook = {
    id: bookId,
    name: bookName || '导入文库',
    createdAt: now
  }

    data.books.push(book)

    for (const chapter of chapters) {
      const page: LyricPage = {
        id: generateId(),
        bookId,
        title: chapter.title?.trim() || '未命名章节',
        content: chapter.content ?? '',
        updatedAt: now
      }
      data.pages.push(page)
    }

    await save(data)
    return bookId
  })()
}

export function generateId(): string {
  return Math.random().toString(36).slice(2, 12)
}
