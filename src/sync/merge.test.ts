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
