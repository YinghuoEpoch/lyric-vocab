import { describe, it, expect } from 'vitest'
import { mergeAppData } from './merge'
import type { Annotation, AppData, LyricPage } from '../types'

function page(id: string, title: string, updatedAt = 100): LyricPage {
  return { id, bookId: 'b1', title, content: title, updatedAt }
}
function ann(id: string, definition: string): Annotation {
  return {
    id,
    docId: 'p1',
    type: 'word',
    start: 'L0W0',
    end: 'L0W0',
    text: 'w',
    order: 0,
    createdAt: 1,
    definition
  }
}
function data(over: Partial<AppData> = {}): AppData {
  return { books: [], pages: [], notes: {}, annotations: [], ...over }
}

/**
 * 三方合并的测试。
 *
 * 这一块是整个同步的心脏：**判错一次就是用户的笔记没了**，
 * 而且丢了不会报错、要过几天才发现。所以每一种情形都单独钉一条。
 */
describe('三方合并', () => {
  it('两边各加各的：都留着（最常见的情况）', () => {
    const base = data({ pages: [page('p1', '旧')] })
    const local = data({ pages: [page('p1', '旧'), page('p2', '手机加的')] })
    const remote = data({ pages: [page('p1', '旧'), page('p3', '平板加的')] })
    const { merged } = mergeAppData(base, local, remote)
    expect(merged.pages.map((p) => p.id).sort()).toEqual(['p1', 'p2', 'p3'])
  })

  it('只有对面改了：听对面的', () => {
    const base = data({ pages: [page('p1', '旧')] })
    const local = data({ pages: [page('p1', '旧')] })
    const remote = data({ pages: [page('p1', '平板改的', 200)] })
    const { merged, report } = mergeAppData(base, local, remote)
    expect(merged.pages[0].title).toBe('平板改的')
    expect(report.pulled).toBe(1)
  })

  it('只有本机改了：听本机的', () => {
    const base = data({ pages: [page('p1', '旧')] })
    const local = data({ pages: [page('p1', '手机改的', 200)] })
    const remote = data({ pages: [page('p1', '旧')] })
    const { merged, report } = mergeAppData(base, local, remote)
    expect(merged.pages[0].title).toBe('手机改的')
    expect(report.pushed).toBe(1)
  })

  it('⚠️ 本机删了、对面没动：删掉 —— 删除靠底本算出来，不需要墓碑', () => {
    const base = data({ pages: [page('p1', '旧'), page('p2', '旧')] })
    const local = data({ pages: [page('p1', '旧')] })
    const remote = data({ pages: [page('p1', '旧'), page('p2', '旧')] })
    const { merged } = mergeAppData(base, local, remote)
    expect(merged.pages.map((p) => p.id)).toEqual(['p1'])
  })

  it('对面删了、本机没动：也删掉', () => {
    const base = data({ pages: [page('p1', '旧'), page('p2', '旧')] })
    const local = data({ pages: [page('p1', '旧'), page('p2', '旧')] })
    const remote = data({ pages: [page('p1', '旧')] })
    const { merged } = mergeAppData(base, local, remote)
    expect(merged.pages.map((p) => p.id)).toEqual(['p1'])
  })

  it('⚠️ 一边删、一边改：保留那次修改 —— 写过的字丢了就没了，删除还能再删一次', () => {
    const base = data({ pages: [page('p1', '旧')] })
    const local = data({ pages: [] })
    const remote = data({ pages: [page('p1', '平板改过了', 200)] })
    const { merged, report } = mergeAppData(base, local, remote)
    expect(merged.pages[0].title).toBe('平板改过了')
    expect(report.rescued).toBe(1)
  })

  it('反过来也一样：对面删了、本机改了，留本机那次修改', () => {
    const base = data({ pages: [page('p1', '旧')] })
    const local = data({ pages: [page('p1', '手机改过了', 200)] })
    const remote = data({ pages: [] })
    const { merged, report } = mergeAppData(base, local, remote)
    expect(merged.pages[0].title).toBe('手机改过了')
    expect(report.rescued).toBe(1)
  })

  it('两边都删了：删掉，没有分歧', () => {
    const base = data({ pages: [page('p1', '旧')] })
    const { merged, report } = mergeAppData(base, data(), data())
    expect(merged.pages).toEqual([])
    expect(report.rescued).toBe(0)
  })

  it('两边都改了同一篇正文：按改动时间取晚的', () => {
    const base = data({ pages: [page('p1', '旧', 100)] })
    const local = data({ pages: [page('p1', '手机改的', 150)] })
    const remote = data({ pages: [page('p1', '平板改的', 200)] })
    const { merged, report } = mergeAppData(base, local, remote)
    expect(merged.pages[0].title).toBe('平板改的')
    expect(report.conflicts).toBe(0)
  })

  it('两边改成了一模一样的内容：不算冲突', () => {
    const base = data({ pages: [page('p1', '旧', 100)] })
    const local = data({ pages: [page('p1', '一样', 150)] })
    const remote = data({ pages: [page('p1', '一样', 150)] })
    const { merged, report } = mergeAppData(base, local, remote)
    expect(merged.pages[0].title).toBe('一样')
    expect(report.conflicts).toBe(0)
  })

  it('⚠️ 标注没有改动时间：两边都改同一条时本机赢，而且要计一笔冲突', () => {
    const base = data({ annotations: [ann('a1', '旧释义')] })
    const local = data({ annotations: [ann('a1', '手机写的')] })
    const remote = data({ annotations: [ann('a1', '平板写的')] })
    const { merged, report } = mergeAppData(base, local, remote)
    expect(merged.annotations?.[0].definition).toBe('手机写的')
    expect(report.conflicts).toBe(1)
  })

  it('标注：两边各划各的词，都留着', () => {
    const base = data({ annotations: [] })
    const local = data({ annotations: [ann('a1', '手机划的')] })
    const remote = data({ annotations: [ann('a2', '平板划的')] })
    const { merged } = mergeAppData(base, local, remote)
    expect(merged.annotations?.map((a) => a.id).sort()).toEqual(['a1', 'a2'])
  })

  it('⚠️ 第一次同步（没有底本）：两台各自已有的东西全都保留，不许吃掉任何一边', () => {
    const local = data({ pages: [page('p1', '手机的')], annotations: [ann('a1', '手机的')] })
    const remote = data({ pages: [page('p2', '平板的')], annotations: [ann('a2', '平板的')] })
    const { merged } = mergeAppData(null, local, remote)
    expect(merged.pages.map((p) => p.id).sort()).toEqual(['p1', 'p2'])
    expect(merged.annotations?.map((a) => a.id).sort()).toEqual(['a1', 'a2'])
  })

  it('第一次同步且两台有同一条但内容不同：本机赢并计冲突，绝不丢', () => {
    const local = data({ annotations: [ann('a1', '手机的')] })
    const remote = data({ annotations: [ann('a1', '平板的')] })
    const { merged, report } = mergeAppData(null, local, remote)
    expect(merged.annotations?.[0].definition).toBe('手机的')
    expect(report.conflicts).toBe(1)
  })

  it('谁都没动：原样不动，一笔账都不记', () => {
    const d = data({ pages: [page('p1', '旧')], annotations: [ann('a1', '旧')] })
    const { merged, report } = mergeAppData(d, d, d)
    expect(merged.pages).toEqual(d.pages)
    expect(report).toEqual({ pulled: 0, pushed: 0, rescued: 0, conflicts: 0 })
  })

  it('回收站里的（软删除）照常同步 —— 那只是带了个删除时间的普通记录', () => {
    const base = data({ pages: [page('p1', '旧')] })
    const local = data({ pages: [page('p1', '旧')] })
    const remote = data({ pages: [{ ...page('p1', '旧', 200), deletedAt: 999 }] })
    const { merged } = mergeAppData(base, local, remote)
    expect(merged.pages[0].deletedAt).toBe(999)
  })

  it('迁移标记取大的 —— 任意一台跑过就不该再跑第二遍', () => {
    const local = data({ annotationsMigratedAt: 500 })
    const remote = data({ annotationsMigratedAt: 900 })
    expect(mergeAppData(null, local, remote).merged.annotationsMigratedAt).toBe(900)
    expect(mergeAppData(null, data(), data()).merged.annotationsMigratedAt).toBeUndefined()
  })

  it('换个方向合，留下的 id 集合一样（内容取舍才看方向）', () => {
    const base = data({ pages: [page('p1', '旧')] })
    const a = data({ pages: [page('p1', '旧'), page('p2', 'A')] })
    const b = data({ pages: [page('p3', 'B')] })
    const ab = mergeAppData(base, a, b).merged.pages.map((p) => p.id).sort()
    const ba = mergeAppData(base, b, a).merged.pages.map((p) => p.id).sort()
    expect(ab).toEqual(ba)
  })
})

/*
 * ⚠️ 从前这儿有一组「只有阅读进度变了吗」的测试，跟着 `onlyProgressChanged`
 * 一起删了（2026-09-04）。进度已经**整个从同步索引里拆出去**，
 * 单独走 progress.json —— 合并这边再也看不见它，也就没什么可判的了。
 * 新的规则和测试在 sync/progress.ts 与 progress.test.ts。
 */


/**
 * 顺序。**用户问出来的**：「要是文档文库的排序变了，这个又会怎么样」。
 *
 * ⚠️ 文库和文档的顺序是**数组位置**表达的，不是存一个字段
 * （见 storage.ts 的 reorderBooks / reorderPages）。
 * 而按 id 建表再吐出来的合并，天然不认识「位置」——
 * 少了专门的处理，你在一台上拖动排序，下一次同步就被悄悄还原了。
 */
describe('排序', () => {
  const P = (id: string) => page(id, id)

  it('⚠️ 本机拖动过顺序：合完要保住，不能被还原', () => {
    const base = data({ pages: [P('p1'), P('p2'), P('p3')] })
    const local = data({ pages: [P('p3'), P('p1'), P('p2')] })
    const remote = data({ pages: [P('p1'), P('p2'), P('p3')] })
    const { merged } = mergeAppData(base, local, remote)
    expect(merged.pages.map((p) => p.id)).toEqual(['p3', 'p1', 'p2'])
  })

  it('对面拖动过顺序：本机跟着变', () => {
    const base = data({ pages: [P('p1'), P('p2'), P('p3')] })
    const local = data({ pages: [P('p1'), P('p2'), P('p3')] })
    const remote = data({ pages: [P('p2'), P('p3'), P('p1')] })
    const { merged } = mergeAppData(base, local, remote)
    expect(merged.pages.map((p) => p.id)).toEqual(['p2', 'p3', 'p1'])
  })

  it('两边都拖过：本机赢（和别处的取舍一致），不丢任何一篇', () => {
    const base = data({ pages: [P('p1'), P('p2'), P('p3')] })
    const local = data({ pages: [P('p3'), P('p2'), P('p1')] })
    const remote = data({ pages: [P('p2'), P('p1'), P('p3')] })
    const { merged } = mergeAppData(base, local, remote)
    expect(merged.pages.map((p) => p.id)).toEqual(['p3', 'p2', 'p1'])
  })

  it('谁都没拖：原样', () => {
    const base = data({ pages: [P('p1'), P('p2')] })
    const { merged } = mergeAppData(base, base, base)
    expect(merged.pages.map((p) => p.id)).toEqual(['p1', 'p2'])
  })

  it('一边拖了顺序、另一边加了新的一篇：顺序保住，新的排在后面', () => {
    const base = data({ pages: [P('p1'), P('p2')] })
    const local = data({ pages: [P('p2'), P('p1')] })
    const remote = data({ pages: [P('p1'), P('p2'), P('p9')] })
    const { merged } = mergeAppData(base, local, remote)
    expect(merged.pages.map((p) => p.id)).toEqual(['p2', 'p1', 'p9'])
  })

  it('⚠️ 只是删了一篇，不能被当成「拖动过顺序」', () => {
    const base = data({ pages: [P('p1'), P('p2'), P('p3')] })
    const local = data({ pages: [P('p1'), P('p3')] })
    const remote = data({ pages: [P('p1'), P('p2'), P('p3')] })
    const { merged } = mergeAppData(base, local, remote)
    expect(merged.pages.map((p) => p.id)).toEqual(['p1', 'p3'])
  })

  it('文库的顺序同理', () => {
    const b = (id: string) => ({ id, name: id, createdAt: 1 })
    const base = data({ books: [b('b1'), b('b2'), b('b3')] })
    const local = data({ books: [b('b2'), b('b3'), b('b1')] })
    const remote = data({ books: [b('b1'), b('b2'), b('b3')] })
    const { merged } = mergeAppData(base, local, remote)
    expect(merged.books.map((x) => x.id)).toEqual(['b2', 'b3', 'b1'])
  })
})

/**
 * 复习页卡片的排序。**用户追问出来的**：
 * 「复习模式下的卡片也有排序功能，这个有考虑到吗」。
 *
 * 从前卡片能拖着排，顺序存在每条记录的 `order` 字段上，同步得整组地合
 * （逐条合会交错成一个谁都没要过的乱序）。手动排序 2026-09-04 去掉了：
 * 次序改成两边各自按正文坐标算，算出来必然一样，**同步这边什么都不用做**。
 *
 * 留这一条钉住「笔记按 id 逐条合就够了」，免得下一个人又把排序逻辑搬回同步里。
 */
describe('复习页卡片的排序（已经不在数据里了）', () => {
  it('两边各自改过同一批笔记：按 id 合，不因为顺序而互相覆盖', () => {
    const base = data({ annotations: [ann('a1', '旧'), ann('a2', '旧')] })
    const local = data({ annotations: [ann('a2', '旧'), ann('a1', '本机改的')] })
    const remote = data({ annotations: [ann('a2', '对面改的'), ann('a1', '旧')] })
    const { merged } = mergeAppData(base, local, remote)
    const byId = new Map(merged.annotations!.map((a) => [a.id, a.definition]))
    expect(byId.get('a1')).toBe('本机改的')
    expect(byId.get('a2')).toBe('对面改的')
  })
})
