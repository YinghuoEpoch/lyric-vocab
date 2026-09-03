import { describe, it, expect } from 'vitest'
import { groupKeyOf, markLastRead, lastReadPageIds, parseLastReadMap, ROOT_GROUP } from './lastRead'
import type { LyricPage } from './types'

function page(id: string, bookId: string | null, extra: Partial<LyricPage> = {}): LyricPage {
  return { id, bookId, title: id, content: '', updatedAt: 0, ...extra }
}

describe('groupKeyOf', () => {
  it('文库用它自己的 id', () => {
    expect(groupKeyOf('b1')).toBe('b1')
  })
  it('不在任何文库里的顶层文档单成一组', () => {
    expect(groupKeyOf(null)).toBe(ROOT_GROUP)
    expect(groupKeyOf(undefined)).toBe(ROOT_GROUP)
  })
})

describe('markLastRead', () => {
  it('每个文库各记一条，互不相干', () => {
    let m = markLastRead({}, page('p1', 'b1'))
    m = markLastRead(m, page('p9', 'b2'))
    expect(m).toEqual({ b1: 'p1', b2: 'p9' })
  })

  it('同一个文库里后来的盖掉先前的 —— 一个文库只留一条', () => {
    let m = markLastRead({}, page('p1', 'b1'))
    m = markLastRead(m, page('p2', 'b1'))
    expect(m).toEqual({ b1: 'p2' })
  })

  it('记的还是同一篇时原样返回，不白白触发重渲染', () => {
    const m = markLastRead({}, page('p1', 'b1'))
    expect(markLastRead(m, page('p1', 'b1'))).toBe(m)
  })

  it('顶层文档记在根那一组', () => {
    expect(markLastRead({}, page('p1', null))).toEqual({ [ROOT_GROUP]: 'p1' })
  })
})

describe('lastReadPageIds', () => {
  it('正常情况：记着哪篇就点亮哪篇', () => {
    const pages = [page('p1', 'b1'), page('p2', 'b1'), page('p9', 'b2')]
    expect(lastReadPageIds({ b1: 'p2', b2: 'p9' }, pages)).toEqual(new Set(['p2', 'p9']))
  })

  it('文档进了回收站就不点亮了（回收站里的不在 activePages 里）', () => {
    expect(lastReadPageIds({ b1: 'p2' }, [page('p1', 'b1')])).toEqual(new Set())
  })

  it('文档被彻底删掉也不点亮', () => {
    expect(lastReadPageIds({ b1: 'gone' }, [page('p1', 'b1')])).toEqual(new Set())
  })

  it('⚠️ 文档被拖去别的文库了，旧文库那条记录当场作废', () => {
    // 少了这一条，b1 会点亮一篇已经搬到 b2 去的文档
    expect(lastReadPageIds({ b1: 'p1' }, [page('p1', 'b2')])).toEqual(new Set())
  })

  it('搬走之后新文库自己的那条记录照常算数', () => {
    expect(lastReadPageIds({ b1: 'p1', b2: 'p1' }, [page('p1', 'b2')])).toEqual(new Set(['p1']))
  })

  it('文库整个进了回收站，里面的文档也就不在名单里', () => {
    expect(lastReadPageIds({ b1: 'p1' }, [])).toEqual(new Set())
  })

  it('顶层文档：记在根组才算数，记在某个文库名下不算', () => {
    expect(lastReadPageIds({ [ROOT_GROUP]: 'p1' }, [page('p1', null)])).toEqual(new Set(['p1']))
    expect(lastReadPageIds({ b1: 'p1' }, [page('p1', null)])).toEqual(new Set())
  })

  it('空表就是谁也不点亮', () => {
    expect(lastReadPageIds({}, [page('p1', 'b1')])).toEqual(new Set())
  })
})

describe('parseLastReadMap', () => {
  it('读得回自己写出去的东西', () => {
    expect(parseLastReadMap(JSON.stringify({ b1: 'p1' }))).toEqual({ b1: 'p1' })
  })

  it('没存过、存坏了、形状不对，一律当没有 —— 一个书签不该把界面弄挂', () => {
    expect(parseLastReadMap(null)).toEqual({})
    expect(parseLastReadMap('')).toEqual({})
    expect(parseLastReadMap('{坏了')).toEqual({})
    expect(parseLastReadMap('[1,2]')).toEqual({})
    expect(parseLastReadMap('"字符串"')).toEqual({})
    expect(parseLastReadMap('null')).toEqual({})
  })

  it('值不是字符串的那几格丢掉，好的留下', () => {
    expect(parseLastReadMap('{"b1":"p1","b2":123,"b3":null,"b4":{"x":1}}')).toEqual({ b1: 'p1' })
  })
})
