import { describe, it, expect } from 'vitest'
import type { Annotation } from '../types'
import { annotationGroupOf } from '../types'
import {
  buildNotesIndex,
  buildPhraseList,
  findAnnotationByKey,
  findRangeAnnotation,
  findWordAnnotation
} from './annotationViews'

/**
 * 短语接进来之后，那些「按类型分路」的地方还对不对。
 *
 * 风险集中在两处：
 * - 短语被当成单词塞进按坐标索引的笔记表 —— 阅读页会在首词底下画半条线
 * - 同一段范围既是短语又是句摘时，保存短语改到句摘头上
 */

const base = {
  docId: 'p1',
  order: 0,
  createdAt: 0
}

const word = (id: string, anchor: string, text: string): Annotation => ({
  ...base,
  id,
  type: 'word',
  start: anchor,
  end: anchor,
  text
})

const phrase = (id: string, start: string, end: string, text: string): Annotation => ({
  ...base,
  id,
  type: 'phrase',
  start,
  end,
  text,
  definition: '起飞',
  grammar: '常用于飞机'
})

const sentence = (id: string, start: string, end: string): Annotation => ({
  ...base,
  id,
  type: 'sentence',
  start,
  end,
  text: '整句话',
  grammar: '倒装',
  meaning: '翻译'
})

describe('排序分组', () => {
  it('单词和短语同属「词汇」—— 它们在复习页是同一列卡片', () => {
    expect(annotationGroupOf('word')).toBe('vocab')
    expect(annotationGroupOf('phrase')).toBe('vocab')
    expect(annotationGroupOf('sentence')).toBe('sentence')
  })
})

describe('短语不混进按坐标索引的单词表', () => {
  it('阅读页的笔记表只收单词', () => {
    const index = buildNotesIndex([word('w', 'L0W0', 'take'), phrase('p', 'L0W0', 'L0W1', 'take off')])
    expect(Object.keys(index.p1)).toEqual(['L0W0'])
    expect(index.p1.L0W0.word).toBe('take')
  })

  it('按坐标找单词时不会摸到短语头上', () => {
    const list = [phrase('p', 'L0W0', 'L0W1', 'take off')]
    expect(findWordAnnotation(list, 'p1', 'L0W0')).toBeUndefined()
  })
})

describe('短语自己的读模型', () => {
  it('按 order 排好，释义与用法各就各位', () => {
    const list = buildPhraseList(
      [{ ...phrase('b', 'L1W0', 'L1W1', 'give up'), order: 1 }, phrase('a', 'L0W0', 'L0W1', 'take off')],
      'p1'
    )
    expect(list.map((p) => p.id)).toEqual(['a', 'b'])
    expect(list[0]).toMatchObject({ text: 'take off', definition: '起飞', usage: '常用于飞机' })
  })

  it('别的文档的短语不会串进来', () => {
    const other = { ...phrase('x', 'L0W0', 'L0W1', 'take off'), docId: 'p2' }
    expect(buildPhraseList([other], 'p1')).toEqual([])
  })
})

describe('同一段范围既是短语又是句摘', () => {
  const list = [phrase('p', 'L0W0', 'L0W3', 'in the long run'), sentence('s', 'L0W0', 'L0W3')]

  it('查短语拿到短语', () => {
    expect(findRangeAnnotation(list, 'p1', 'L0W0', 'L0W3', 'phrase')?.id).toBe('p')
  })

  it('查句摘拿到句摘（默认就是句摘，老调用不受影响）', () => {
    expect(findRangeAnnotation(list, 'p1', 'L0W0', 'L0W3')?.id).toBe('s')
  })
})

describe('右侧栏按键找标注', () => {
  it('短语用首词坐标也找得到（右侧栏的删除走这条路）', () => {
    expect(findAnnotationByKey([phrase('p', 'L0W0', 'L0W1', 'take off')], 'p1', 'L0W0')?.id).toBe('p')
  })

  it('同一个坐标上既有单词又有短语时，单词优先', () => {
    const list = [phrase('p', 'L0W0', 'L0W1', 'take off'), word('w', 'L0W0', 'take')]
    expect(findAnnotationByKey(list, 'p1', 'L0W0')?.id).toBe('w')
  })

  it('孤儿短语没有坐标，用 id 找得到', () => {
    const orphan = { ...phrase('p', 'L0W0', 'L0W1', 'take off'), start: null, end: null }
    expect(findAnnotationByKey([orphan], 'p1', 'p')?.id).toBe('p')
  })
})
