import { describe, it, expect } from 'vitest'
import { getFolderReviewData } from './getFolderReviewData'
import type { Annotation, LyricPage } from '../types'

const page = (id: string, bookId: string | null, over: Partial<LyricPage> = {}): LyricPage => ({
  id,
  bookId,
  title: id,
  content: '',
  updatedAt: 0,
  ...over
})

const word = (id: string, docId: string, text: string, over: Partial<Annotation> = {}): Annotation => ({
  id,
  docId,
  type: 'word',
  start: 'L0W0',
  end: 'L0W0',
  text,
  order: 0,
  createdAt: 1,
  ...over
})

const PAGES = [
  page('p1', 'b1'),
  page('p2', 'b1', { title: '第二章' }),
  page('p3', 'b2'), // 别的文库
  page('p4', 'b1', { deletedAt: 1 }) // 回收站里的
]

describe('getFolderReviewData', () => {
  it('同一个词在多篇文档里出现时合并成一条，并记下频次', () => {
    const { high, normal } = getFolderReviewData('b1', PAGES, [
      word('a', 'p1', 'stood', { definition: '站立' }),
      word('b', 'p2', 'stood'),
      word('c', 'p1', 'walked')
    ])

    expect(high.map((i) => [i.word, i.frequency])).toEqual([['stood', 2]])
    expect(normal.map((i) => i.word)).toEqual(['walked'])
    // 合并时保留第一次出现的释义
    expect(high[0].definition).toBe('站立')
  })

  it('大小写不同算同一个词', () => {
    const { high } = getFolderReviewData('b1', PAGES, [
      word('a', 'p1', 'Stood'),
      word('b', 'p2', 'stood')
    ])
    expect(high).toHaveLength(1)
    expect(high[0].frequency).toBe(2)
  })

  it('只看这个文库，别的文库和回收站里的都不算', () => {
    const { normal } = getFolderReviewData('b1', PAGES, [
      word('a', 'p1', 'kept'),
      word('b', 'p3', 'otherBook'),
      word('c', 'p4', 'inTrash')
    ])
    expect(normal.map((i) => i.word)).toEqual(['kept'])
  })

  it('句摘不参与 —— 这是生词表', () => {
    const { high, normal } = getFolderReviewData('b1', PAGES, [
      word('s', 'p1', '一整句话', { type: 'sentence', end: 'L0W5' }),
      word('a', 'p1', 'real')
    ])
    expect([...high, ...normal].map((i) => i.word)).toEqual(['real'])
  })

  it('高频排在一组、按频次从高到低；单次的另一组、按字母序', () => {
    const { high, normal } = getFolderReviewData('b1', PAGES, [
      word('a1', 'p1', 'twice'),
      word('a2', 'p2', 'twice'),
      word('b1', 'p1', 'thrice'),
      word('b2', 'p2', 'thrice'),
      word('b3', 'p1', 'thrice'),
      word('c', 'p1', 'zebra'),
      word('d', 'p1', 'apple')
    ])
    expect(high.map((i) => i.word)).toEqual(['thrice', 'twice'])
    expect(normal.map((i) => i.word)).toEqual(['apple', 'zebra'])
  })

  it('原文已删除 / AI 填充的标记会带到文库卡片上', () => {
    const { normal } = getFolderReviewData('b1', PAGES, [
      word('a', 'p1', 'gone', { start: null, end: null }),
      word('b', 'p1', 'guessed', { auto: true })
    ])
    const byWord = new Map(normal.map((i) => [i.word, i]))
    expect(byWord.get('gone')!.orphaned).toBe(true)
    expect(byWord.get('guessed')!.auto).toBe(true)
    expect(byWord.get('guessed')!.orphaned).toBeUndefined()
  })

  it('文档标题带在条目上，卡片要显示它来自哪一篇', () => {
    const { normal } = getFolderReviewData('b1', PAGES, [word('a', 'p2', 'x')])
    expect(normal[0].pageTitle).toBe('第二章')
    expect(normal[0].pageId).toBe('p2')
  })

  it('空文库返回两个空组，不炸', () => {
    expect(getFolderReviewData('b1', PAGES, [])).toEqual({ high: [], normal: [] })
  })
})
