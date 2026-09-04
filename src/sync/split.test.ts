import { describe, it, expect } from 'vitest'
import {
  contentRev,
  contentsOf,
  fromIndex,
  looksLikeLegacy,
  orphanPages,
  pagesToDownload,
  pagesToUpload,
  toIndex,
  type SyncIndex
} from './split'
import type { AppData } from '../types'

function page(id: string, content: string) {
  return { id, bookId: 'b1', title: id, content, updatedAt: 1 }
}
function data(pages: ReturnType<typeof page>[]): AppData {
  return { books: [], pages, notes: {}, annotations: [] }
}

describe('内容指纹', () => {
  it('同一段文字指纹一样，不同就不一样', () => {
    expect(contentRev('hello')).toBe(contentRev('hello'))
    expect(contentRev('hello')).not.toBe(contentRev('hellp'))
  })

  it('⚠️ 只差一个字也要认出来 —— 认不出就等于那次编辑永远同步不出去', () => {
    const long = 'I never stood up very tall. '.repeat(2000)
    expect(contentRev(long)).not.toBe(contentRev(long + '.'))
    expect(contentRev(long)).not.toBe(contentRev(long.replace('never', 'nevar')))
  })

  it('长度也拼进指纹里，白捡一层保险', () => {
    expect(contentRev('ab')).not.toBe(contentRev('abc'))
    expect(contentRev('')).toBe(contentRev(''))
  })

  it('中文也认', () => {
    expect(contentRev('我从未挺起胸膛')).not.toBe(contentRev('我从未挺起胸脯'))
  })
})

describe('拆开与还原', () => {
  it('拆了再拼，一个字不差', () => {
    const d = data([page('p1', '正文一'), page('p2', '正文二')])
    expect(fromIndex(toIndex(d), contentsOf(d), d.notes)).toEqual(d)
  })

  it('索引里没有正文（这才是省流量的来头）', () => {
    const idx = toIndex(data([page('p1', 'x'.repeat(100000))]))
    expect(JSON.stringify(idx).length).toBeLessThan(500)
    expect(JSON.stringify(idx)).not.toContain('xxxx')
  })

  it('⚠️ 取不到正文时给空字符串，不能把这篇文档丢掉', () => {
    // 宁可显示成一篇空文档（一眼看得出不对、下次同步补回来），
    // 也不能让它从文库里消失 —— 那会让人以为自己的书没了
    const idx = toIndex(data([page('p1', '正文')]))
    const restored = fromIndex(idx, new Map(), {})
    expect(restored.pages).toHaveLength(1)
    expect(restored.pages[0].content).toBe('')
  })

  it('文档的其它字段（标题、进度、回收站标记）原样留着', () => {
    const d: AppData = {
      books: [],
      notes: {},
      annotations: [],
      pages: [{ ...page('p1', '正文'), progress: 1200, deletedAt: 999 }]
    }
    const back = fromIndex(toIndex(d), contentsOf(d), d.notes)
    expect(back.pages[0].progress).toBe(1200)
    expect(back.pages[0].deletedAt).toBe(999)
  })
})

describe('哪几篇要下载', () => {
  const merged = toIndex(data([page('p1', 'A'), page('p2', 'B')]))

  it('手上那份就是要的那一版：不下载（这是常态，也是省流量的关键）', () => {
    expect(pagesToDownload(merged, new Map([['p1', 'A'], ['p2', 'B']]))).toEqual([])
  })

  it('对面改过的那一篇才下载', () => {
    expect(pagesToDownload(merged, new Map([['p1', 'A'], ['p2', '旧的 B']]))).toEqual(['p2'])
  })

  it('本地压根没有的那一篇要下载', () => {
    expect(pagesToDownload(merged, new Map([['p1', 'A']]))).toEqual(['p2'])
  })
})

describe('哪几篇要上传', () => {
  const merged = toIndex(data([page('p1', 'A'), page('p2', 'B')]))

  it('云端已经是这一版：不传', () => {
    expect(pagesToUpload(merged, merged)).toEqual([])
  })

  it('云端那一篇是旧的：传', () => {
    const remote = toIndex(data([page('p1', 'A'), page('p2', '旧的 B')]))
    expect(pagesToUpload(merged, remote)).toEqual(['p2'])
  })

  it('⚠️ 云端压根没有这一篇：也要传，否则那本书传上去只有壳没有正文', () => {
    const remote = toIndex(data([page('p1', 'A')]))
    expect(pagesToUpload(merged, remote)).toEqual(['p2'])
  })

  it('云端一个文件都没有（第一次）：全传', () => {
    expect(pagesToUpload(merged, null)).toEqual(['p1', 'p2'])
  })
})

describe('清掉没人要的正文文件', () => {
  it('文档被彻底删了，它的正文文件也该清掉', () => {
    const merged = toIndex(data([page('p1', 'A')]))
    const remote = toIndex(data([page('p1', 'A'), page('p2', 'B')]))
    expect(orphanPages(merged, remote)).toEqual(['p2'])
  })

  it('还在的一个都不动', () => {
    const merged = toIndex(data([page('p1', 'A'), page('p2', 'B')]))
    expect(orphanPages(merged, merged)).toEqual([])
  })
})

describe('认得出旧格式', () => {
  it('⚠️ 旧格式（正文就在那一整块里）要认出来 —— 认不出等于把已经同步上去的弄丢', () => {
    expect(looksLikeLegacy({ pages: [{ id: 'p1', content: '正文' }] })).toBe(true)
  })

  it('新格式（只有指纹）不算旧的', () => {
    expect(looksLikeLegacy(toIndex(data([page('p1', 'A')])) as unknown)).toBe(false)
  })

  it('空的、坏的都不算', () => {
    expect(looksLikeLegacy({ pages: [] })).toBe(false)
    expect(looksLikeLegacy(null)).toBe(false)
    expect(looksLikeLegacy({})).toBe(false)
  })
})

describe('索引的形状能喂给现成的三方合并', () => {
  it('指纹在索引的文档对象里，所以「正文变了」会被合并当成「这条变了」', () => {
    const a = toIndex(data([page('p1', '旧正文')]))
    const b = toIndex(data([page('p1', '新正文')]))
    // 两个索引里同一篇文档的对象必须不相等，合并才看得见这次改动
    expect(JSON.stringify(a.pages[0])).not.toBe(JSON.stringify(b.pages[0]))
  })

  it('只改了滚动位置时，指纹不变（正文没动就不该传正文）', () => {
    const a = toIndex(data([page('p1', '正文')]))
    const withProgress: SyncIndex = {
      ...a,
      pages: [{ ...a.pages[0], progress: 999 }]
    }
    expect(withProgress.pages[0].contentRev).toBe(a.pages[0].contentRev)
  })
})
