import { describe, it, expect } from 'vitest'
import { parseCatalog, searchIn } from './catalog'

/**
 * 目录用制表符分三格：编号、书名、作者。
 * 真实数据里作者可以是空的（很多古籍没署名），书名里带标点和数字也很常见。
 */
const SAMPLE = [
  '1342\tPride and Prejudice\tAusten, Jane',
  '161\tSense and Sensibility\tAusten, Jane',
  '2701\tMoby Dick; Or, The Whale\tMelville, Herman',
  '11\tAlice’s Adventures in Wonderland\tCarroll, Lewis',
  '4\tLincoln’s Gettysburg Address\t',
  '84\tFrankenstein; Or, The Modern Prometheus\tShelley, Mary Wollstonecraft'
].join('\n')

const cat = parseCatalog(SAMPLE)

describe('parseCatalog', () => {
  it('空行不算一条书目', () => {
    expect(parseCatalog('1\tA\tB\n\n2\tC\tD\n').lines).toHaveLength(2)
  })
})

describe('searchIn', () => {
  it('按书名搜', () => {
    expect(searchIn(cat, 'prejudice').map((b) => b.id)).toEqual([1342])
  })

  it('按作者搜，能一次搜出同一个人的多本', () => {
    expect(searchIn(cat, 'austen').map((b) => b.id)).toEqual([1342, 161])
  })

  it('不分大小写', () => {
    expect(searchIn(cat, 'MOBY').map((b) => b.id)).toEqual([2701])
  })

  it('多个词要全部命中，顺序无所谓', () => {
    // 书名出一个词、作者出一个词，也算命中 —— 这正是「austen pride」该有的表现
    expect(searchIn(cat, 'austen pride').map((b) => b.id)).toEqual([1342])
    expect(searchIn(cat, 'pride austen').map((b) => b.id)).toEqual([1342])
  })

  it('少命中一个词就不算', () => {
    expect(searchIn(cat, 'austen whale')).toEqual([])
  })

  it('空搜索返回空，不是返回全部', () => {
    // 六万条一次全渲染出来会把界面卡死，这条是防线
    expect(searchIn(cat, '')).toEqual([])
    expect(searchIn(cat, '   ')).toEqual([])
  })

  it('作者为空的书目照样能搜到，且作者是空串不是 undefined', () => {
    const [hit] = searchIn(cat, 'gettysburg')
    expect(hit.id).toBe(4)
    expect(hit.author).toBe('')
  })

  it('编号解析成数字 —— 下载地址靠它拼', () => {
    expect(searchIn(cat, 'frankenstein')[0].id).toBe(84)
  })

  it('凑够 limit 就停', () => {
    expect(searchIn(cat, 'the', 2)).toHaveLength(2)
  })
})
