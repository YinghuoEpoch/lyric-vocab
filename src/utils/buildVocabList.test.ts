import { describe, it, expect } from 'vitest'
import type { Annotation } from '../types'
import { buildVocabList } from './annotationViews'

/**
 * 右侧生词板的清单。
 *
 * 钉住的是那个真实发生过的 bug：从前这份清单先塞全部单词、再把短语追加在末尾，
 * 于是新标的短语永远出现在最后一条，跟它在正文里的位置无关 ——
 * 而同一批数据在复习页是按正文顺序排的，两边对不上。
 */

const base = { docId: 'p1', createdAt: 0 }

const word = (id: string, anchor: string, text: string, order: number): Annotation => ({
  ...base,
  id,
  type: 'word',
  start: anchor,
  end: anchor,
  text,
  order,
  phonetic: `/${text}/`,
  pos: 'v.'
})

const phrase = (id: string, start: string, end: string, text: string, order: number): Annotation => ({
  ...base,
  id,
  type: 'phrase',
  start,
  end,
  text,
  order,
  definition: '起飞',
  grammar: '常用于飞机'
})

const active = new Set(['p1'])

describe('右侧生词板的清单', () => {
  it('短语按 order 插在单词中间，不再被甩到末尾', () => {
    // 正文顺序：Flying(6) / Flying high or(6.5) / below(7)
    const list = buildVocabList(
      [
        word('w1', 'L38W0', 'Flying', 6),
        word('w2', 'L38W4', 'below', 7),
        phrase('p1a', 'L38W0', 'L38W2', 'Flying high or', 6.5)
      ],
      active
    )
    expect(list.map((v) => v.word)).toEqual(['Flying', 'Flying high or', 'below'])
  })

  it('短语带 isPhrase 标记，且不带音标词性（卡片上那两格根本不画）', () => {
    const list = buildVocabList([phrase('p1a', 'L0W0', 'L0W1', 'take off', 0)], active)
    expect(list[0].isPhrase).toBe(true)
    expect(list[0].definition).toBe('起飞')
    expect(list[0].phonetic).toBeUndefined()
    expect(list[0].pos).toBeUndefined()
  })

  it('单词不带 isPhrase，音标词性照旧', () => {
    const list = buildVocabList([word('w1', 'L0W0', 'stood', 0)], active)
    expect(list[0].isPhrase).toBeUndefined()
    expect(list[0].phonetic).toBe('/stood/')
    expect(list[0].pos).toBe('v.')
  })

  it('句摘不进这份清单', () => {
    const list = buildVocabList(
      [
        word('w1', 'L0W0', 'stood', 0),
        { ...base, id: 's1', type: 'sentence', start: 'L0W0', end: 'L0W3', text: '整句话', order: 0 }
      ],
      active
    )
    expect(list.map((v) => v.word)).toEqual(['stood'])
  })

  it('不在回收站之外的文档一律不收', () => {
    const list = buildVocabList(
      [word('w1', 'L0W0', 'stood', 0), { ...word('w2', 'L0W1', 'up', 1), docId: 'deleted' }],
      active
    )
    expect(list.map((v) => v.word)).toEqual(['stood'])
  })

  it('孤儿（原文已删除）用自己的 id 当键，删除那条路认得', () => {
    const orphan: Annotation = { ...word('w9', 'L0W0', 'gone', 0), start: null, end: null }
    const list = buildVocabList([orphan], active)
    expect(list[0].orphaned).toBe(true)
    expect(list[0].anchorId).toBe('w9')
  })

  it('两条标注撞同一个坐标时，后来的退回用 id —— 两条都留下', () => {
    const list = buildVocabList(
      [word('w1', 'L0W0', 'take', 0), phrase('p1a', 'L0W0', 'L0W1', 'take off', 1)],
      active
    )
    expect(list.map((v) => v.anchorId)).toEqual(['L0W0', 'p1a'])
  })

  it('多篇文档各自成段，段内按 order 排', () => {
    const list = buildVocabList(
      [
        { ...word('a', 'L0W0', 'second', 1) },
        { ...word('b', 'L0W0', 'first', 0) },
        { ...word('c', 'L0W0', 'other', 0), docId: 'p2' }
      ],
      new Set(['p1', 'p2'])
    )
    expect(list.filter((v) => v.pageId === 'p1').map((v) => v.word)).toEqual(['first', 'second'])
    expect(list.filter((v) => v.pageId === 'p2').map((v) => v.word)).toEqual(['other'])
  })
})
