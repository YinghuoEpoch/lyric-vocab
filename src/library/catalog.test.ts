import { describe, it, expect } from 'vitest'
import { parseCatalog, searchIn } from './catalog'

/**
 * 目录用制表符分四格：源、定位、书名、作者。
 *
 * - `g` 是美国站，定位是书的编号
 * - `a` 是澳洲站，定位是站内路径（它的地址没规律，只能整条存着）
 *
 * 真实数据里作者可以是空的（很多古籍没署名），书名带标点和数字也很常见。
 */
const SAMPLE = [
  'g\t1342\tPride and Prejudice\tAusten, Jane',
  'g\t161\tSense and Sensibility\tAusten, Jane',
  'g\t2701\tMoby Dick; Or, The Whale\tMelville, Herman',
  'g\t11\tAlice’s Adventures in Wonderland\tCarroll, Lewis',
  'g\t4\tLincoln’s Gettysburg Address\t',
  'a\tebooks01/0100021.txt\tNineteen eighty-four\tGeorge Orwell',
  'a\tebooks01/0100011.txt\tAnimal Farm\tGeorge Orwell'
].join('\n')

const cat = parseCatalog(SAMPLE)

describe('parseCatalog', () => {
  it('空行不算一条书目', () => {
    expect(parseCatalog('g\t1\tA\tB\n\ng\t2\tC\tD\n').lines).toHaveLength(2)
  })
})

describe('searchIn', () => {
  it('按书名搜', () => {
    expect(searchIn(cat, 'prejudice').map((b) => b.ref)).toEqual(['1342'])
  })

  it('按作者搜，能一次搜出同一个人的多本', () => {
    expect(searchIn(cat, 'austen').map((b) => b.ref)).toEqual(['1342', '161'])
  })

  it('不分大小写', () => {
    expect(searchIn(cat, 'MOBY').map((b) => b.ref)).toEqual(['2701'])
  })

  it('多个词要全部命中，顺序无所谓', () => {
    // 书名出一个词、作者出一个词，也算命中 —— 这正是「austen pride」该有的表现
    expect(searchIn(cat, 'austen pride').map((b) => b.ref)).toEqual(['1342'])
    expect(searchIn(cat, 'pride austen').map((b) => b.ref)).toEqual(['1342'])
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
    expect(hit.ref).toBe('4')
    expect(hit.author).toBe('')
  })

  it('凑够 limit 就停', () => {
    expect(searchIn(cat, 'e', 2)).toHaveLength(2)
  })

  it('只拿书名和作者去匹配，源和定位不算', () => {
    // 澳洲站的定位是 ebooks01/0100021.txt 这样的路径。算进去的话
    // 搜「txt」会把一千多本澳洲书一次全捞出来 —— 加第二个源时当场撞到过
    expect(searchIn(cat, 'txt')).toEqual([])
    expect(searchIn(cat, 'ebooks')).toEqual([])
  })

  it('两个源混在一起搜，各自带着自己的来源标记', () => {
    // 用户搜的时候不分源，但下载时必须知道去哪个站、按什么格式取
    const orwell = searchIn(cat, 'orwell')
    expect(orwell.map((b) => b.source)).toEqual(['a', 'a'])
    expect(orwell[0].ref).toBe('ebooks01/0100021.txt')

    expect(searchIn(cat, 'austen')[0].source).toBe('g')
  })

  it('源的字母认不出来时当成美国站，不要崩', () => {
    const odd = parseCatalog('x\t9\tWeird\tNobody')
    expect(searchIn(odd, 'weird')[0].source).toBe('g')
  })
})
