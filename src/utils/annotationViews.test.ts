import { describe, it, expect } from 'vitest'
import {
  annotationKey,
  annotationToWordNote,
  annotationToSentence,
  buildNotesIndex,
  buildSentenceList,
  findWordAnnotation,
  findAnnotationByKey,
  findRangeAnnotation
} from './annotationViews'
import type { Annotation } from '../types'

const word = (over: Partial<Annotation> = {}): Annotation => ({
  id: 'a1',
  docId: 'p1',
  type: 'word',
  start: 'L0W0',
  end: 'L0W0',
  text: 'stood',
  order: 0,
  createdAt: 100,
  ...over
})

const sentence = (over: Partial<Annotation> = {}): Annotation => ({
  id: 's1',
  docId: 'p1',
  type: 'sentence',
  start: 'L0W0',
  end: 'L0W3',
  text: 'I have a dream',
  order: 0,
  createdAt: 200,
  grammar: '主谓宾',
  meaning: '我有一个梦想',
  ...over
})

describe('annotationKey', () => {
  it('有位置就用坐标', () => {
    expect(annotationKey(word())).toBe('L0W0')
  })

  it('孤儿没有位置，改用自己的 id —— 不可能和坐标撞车', () => {
    const k = annotationKey(word({ id: 'xyz', start: null, end: null }))
    expect(k).toBe('xyz')
    expect(/^L\d+W\d+$/.test(k)).toBe(false)
  })
})

describe('转成旧读模型', () => {
  it('单词：字段照搬，没填的不留空键', () => {
    expect(annotationToWordNote(word({ phonetic: '/stʊd/', definition: '站立' }))).toEqual({
      word: 'stood',
      phonetic: '/stʊd/',
      definition: '站立'
    })
  })

  it('单词：没有位置 = 原文已删除', () => {
    expect(annotationToWordNote(word({ start: null, end: null })).orphaned).toBe(true)
    expect(annotationToWordNote(word()).orphaned).toBeUndefined()
  })

  it('句摘：id 与创建时间原样带出', () => {
    expect(annotationToSentence(sentence())).toEqual({
      id: 's1',
      text: 'I have a dream',
      grammar: '主谓宾',
      meaning: '我有一个梦想',
      docId: 'p1',
      startAnchorId: 'L0W0',
      endAnchorId: 'L0W3',
      date: 200
    })
  })

  it('句摘：孤儿标出来，起止坐标留空', () => {
    const s = annotationToSentence(sentence({ start: null, end: null }))
    expect(s.orphaned).toBe(true)
    expect(s.startAnchorId).toBe('')
    expect(s.text).toBe('I have a dream') // 原文留着，日后好找回来
  })

  it('AI 标记两边都带过去', () => {
    expect(annotationToWordNote(word({ auto: true })).auto).toBe(true)
    expect(annotationToSentence(sentence({ auto: true })).auto).toBe(true)
  })
})

describe('buildNotesIndex', () => {
  it('按 order 的次序塞键 —— 卡片顺序就是这么定的', () => {
    const index = buildNotesIndex([
      word({ id: 'c', start: 'L9W0', end: 'L9W0', text: 'third', order: 2 }),
      word({ id: 'a', start: 'L0W0', end: 'L0W0', text: 'first', order: 0 }),
      word({ id: 'b', start: 'L4W0', end: 'L4W0', text: 'second', order: 1 })
    ])
    expect(Object.values(index.p1).map((n) => n.word)).toEqual(['first', 'second', 'third'])
  })

  it('句摘不进单词表', () => {
    const index = buildNotesIndex([word(), sentence()])
    expect(Object.keys(index.p1)).toEqual(['L0W0'])
  })

  it('孤儿用 id 当键，不占任何真实坐标', () => {
    const index = buildNotesIndex([word({ id: 'ghost', start: null, end: null })])
    expect(Object.keys(index.p1)).toEqual(['ghost'])
  })

  it('按文档分开', () => {
    const index = buildNotesIndex([word({ id: 'a' }), word({ id: 'b', docId: 'p2' })])
    expect(Object.keys(index).sort()).toEqual(['p1', 'p2'])
  })

  it('万一两条标注撞在同一个坐标上，也不会互相覆盖', () => {
    const index = buildNotesIndex([
      word({ id: 'a', text: 'one', order: 0 }),
      word({ id: 'b', text: 'two', order: 1 })
    ])
    expect(Object.keys(index.p1).sort()).toEqual(['L0W0', 'b'])
    expect(Object.values(index.p1).map((n) => n.word).sort()).toEqual(['one', 'two'])
  })
})

describe('buildSentenceList', () => {
  it('只要句摘，并按 order 排', () => {
    const list = buildSentenceList([
      sentence({ id: 'b', order: 1, text: 'second' }),
      word(),
      sentence({ id: 'a', order: 0, text: 'first' })
    ])
    expect(list.map((s) => s.text)).toEqual(['first', 'second'])
  })
})

describe('查找', () => {
  const all = [
    word({ id: 'w1', start: 'L0W0', end: 'L0W0' }),
    word({ id: 'ghost', start: null, end: null, text: 'gone' }),
    sentence({ id: 's1' }),
    word({ id: 'other', docId: 'p2' })
  ]

  it('按坐标找单词标注，认文档', () => {
    expect(findWordAnnotation(all, 'p1', 'L0W0')?.id).toBe('w1')
    expect(findWordAnnotation(all, 'p2', 'L0W0')?.id).toBe('other')
    expect(findWordAnnotation(all, 'p1', 'L9W9')).toBeUndefined()
  })

  it('按坐标找时不会误抓到句摘', () => {
    // 句摘 s1 的 start 也是 L0W0
    expect(findWordAnnotation(all, 'p1', 'L0W0')?.type).toBe('word')
  })

  it('按读模型的键找：坐标和 id 两种都认', () => {
    expect(findAnnotationByKey(all, 'p1', 'L0W0')?.id).toBe('w1')
    expect(findAnnotationByKey(all, 'p1', 'ghost')?.id).toBe('ghost')
    expect(findAnnotationByKey(all, 'p1', '不存在')).toBeUndefined()
  })

  it('按范围找句摘', () => {
    expect(findRangeAnnotation(all, 'p1', 'L0W0', 'L0W3')?.id).toBe('s1')
    expect(findRangeAnnotation(all, 'p1', 'L0W0', 'L0W9')).toBeUndefined()
  })
})
