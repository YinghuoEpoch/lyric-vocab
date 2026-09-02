import { describe, it, expect, vi } from 'vitest'
import type { Annotation, AppData } from './types'

/**
 * 清空回收站。
 *
 * 这是**永久删除**，而且一次删一大批，所以这组测试的重点不是「删干净了没有」，
 * 是**「有没有误删回收站外的东西」**。删错了没有任何办法找回来。
 *
 * localforage 换成内存里的一个 Map —— 测的是我们自己的逻辑，不是 IndexedDB。
 * 每个用例都重新载入模块，因为 storage.ts 有一份模块级的 cache。
 */
vi.mock('localforage', () => {
  const store = new Map<string, unknown>()
  return {
    default: {
      getItem: async (k: string) => (store.has(k) ? store.get(k) : null),
      setItem: async (k: string, v: unknown) => {
        store.set(k, v)
        return v
      }
    }
  }
})

const KEY = 'lyric-vocab-data'

const book = (id: string, deleted = false) => ({
  id,
  name: id,
  createdAt: 0,
  ...(deleted ? { deletedAt: 1 } : {})
})

const page = (id: string, bookId: string | null = null, deleted = false) => ({
  id,
  bookId,
  title: id,
  content: '',
  updatedAt: 0,
  ...(deleted ? { deletedAt: 1 } : {})
})

const anno = (id: string, docId: string): Annotation => ({
  id,
  docId,
  type: 'word',
  start: 'L0W0',
  end: 'L0W0',
  text: 'x',
  order: 0,
  createdAt: 1
})

async function fresh(seed: Partial<AppData>) {
  vi.resetModules()
  const localforage = (await import('localforage')).default
  await localforage.setItem(KEY, { books: [], pages: [], notes: {}, ...seed })
  return await import('./storage')
}

describe('emptyTrash', () => {
  it('回收站里的文库和文档全删掉', async () => {
    const s = await fresh({
      books: [book('b1', true), book('b2', true)],
      pages: [page('p1', 'b1', true), page('p2', null, true)]
    })
    const data = await s.emptyTrash()
    expect(data.books).toEqual([])
    expect(data.pages).toEqual([])
  })

  it('**没删的东西一样不能动** —— 这条是这组测试的重点', async () => {
    const s = await fresh({
      books: [book('keep'), book('gone', true)],
      pages: [page('keepPage', 'keep'), page('gonePage', 'gone', true)],
      notes: { keepPage: {}, gonePage: {} },
      annotations: [anno('a1', 'keepPage'), anno('a2', 'gonePage')]
    })
    const data = await s.emptyTrash()

    expect(data.books.map((b) => b.id)).toEqual(['keep'])
    expect(data.pages.map((p) => p.id)).toEqual(['keepPage'])
    expect(Object.keys(data.notes)).toEqual(['keepPage'])
    expect(data.annotations?.map((a) => a.id)).toEqual(['a1'])
  })

  it('笔记和标注跟着被删的文档一起清掉，不留够不着的垃圾', async () => {
    const s = await fresh({
      pages: [page('p1', null, true)],
      notes: { p1: {} },
      annotations: [anno('a1', 'p1')]
    })
    const data = await s.emptyTrash()
    expect(data.notes).toEqual({})
    expect(data.annotations).toEqual([])
  })

  it('没被删的文档挂在被删的文库下时，提升到根级而不是跟着消失', async () => {
    // 文档可以被单独恢复（restorePage），所以「父库在回收站、子文档不在」是真会出现的
    const s = await fresh({
      books: [book('b1', true)],
      pages: [page('survivor', 'b1')]
    })
    const data = await s.emptyTrash()
    expect(data.books).toEqual([])
    expect(data.pages).toHaveLength(1)
    expect(data.pages[0].id).toBe('survivor')
    expect(data.pages[0].bookId).toBeNull()
  })

  it('回收站是空的时候什么都不做', async () => {
    const s = await fresh({
      books: [book('b1')],
      pages: [page('p1', 'b1')],
      notes: { p1: {} }
    })
    const data = await s.emptyTrash()
    expect(data.books.map((b) => b.id)).toEqual(['b1'])
    expect(data.pages.map((p) => p.id)).toEqual(['p1'])
    expect(Object.keys(data.notes)).toEqual(['p1'])
  })

  it('清完再读一次，结果是落了盘的，不是只改了内存', async () => {
    const s = await fresh({
      books: [book('b1', true)],
      pages: [page('p1', null, true)]
    })
    await s.emptyTrash()
    const again = await s.getAppData()
    expect(again.books).toEqual([])
    expect(again.pages).toEqual([])
  })
})
