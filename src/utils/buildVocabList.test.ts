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

const word = (id: string, anchor: string, text: string): Annotation => ({
  ...base,
  id,
  type: 'word',
  start: anchor,
  end: anchor,
  text,
  phonetic: `/${text}/`,
  pos: 'v.'
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

const active = new Set(['p1'])

describe('右侧生词板的清单', () => {
  it('短语按正文位置插在单词中间，不再被甩到末尾', () => {
    // 正文顺序：Flying(6) / Flying high or(6.5) / below(7)
    const list = buildVocabList(
      [
        word('w1', 'L38W0', 'Flying'),
        word('w2', 'L38W4', 'below'),
        phrase('p1a', 'L38W0', 'L38W2', 'Flying high or')
      ],
      active
    )
    expect(list.map((v) => v.word)).toEqual(['Flying', 'Flying high or', 'below'])
  })

  it('短语带 isPhrase 标记，且不带音标词性（卡片上那两格根本不画）', () => {
    const list = buildVocabList([phrase('p1a', 'L0W0', 'L0W1', 'take off')], active)
    expect(list[0].isPhrase).toBe(true)
    expect(list[0].definition).toBe('起飞')
    expect(list[0].phonetic).toBeUndefined()
    expect(list[0].pos).toBeUndefined()
  })

  it('单词不带 isPhrase，音标词性照旧', () => {
    const list = buildVocabList([word('w1', 'L0W0', 'stood')], active)
    expect(list[0].isPhrase).toBeUndefined()
    expect(list[0].phonetic).toBe('/stood/')
    expect(list[0].pos).toBe('v.')
  })

  it('句摘不进这份清单', () => {
    const list = buildVocabList(
      [
        word('w1', 'L0W0', 'stood'),
        { ...base, id: 's1', type: 'sentence', start: 'L0W0', end: 'L0W3', text: '整句话' }
      ],
      active
    )
    expect(list.map((v) => v.word)).toEqual(['stood'])
  })

  it('不在回收站之外的文档一律不收', () => {
    const list = buildVocabList(
      [word('w1', 'L0W0', 'stood'), { ...word('w2', 'L0W1', 'up'), docId: 'deleted' }],
      active
    )
    expect(list.map((v) => v.word)).toEqual(['stood'])
  })

  it('孤儿（原文已删除）用自己的 id 当键，删除那条路认得', () => {
    const orphan: Annotation = { ...word('w9', 'L0W0', 'gone'), start: null, end: null }
    const list = buildVocabList([orphan], active)
    expect(list[0].orphaned).toBe(true)
    expect(list[0].anchorId).toBe('w9')
  })

  it('两条标注撞同一个坐标时，后来的退回用 id —— 两条都留下', () => {
    const list = buildVocabList(
      [word('w1', 'L0W0', 'take'), phrase('p1a', 'L0W0', 'L0W1', 'take off')],
      active
    )
    expect(list.map((v) => v.anchorId)).toEqual(['L0W0', 'p1a'])
  })

  /**
   * 用户报的：右侧栏点一些短语跳不到正文里去，而且**偏偏是和单词重叠的那些**
   * （单独划 all、单独划 all right 都好使，两个一起划，all right 就跳不动了）。
   *
   * 根子是一个字段被拿去干两件事：`anchorId` 既是身份又是门牌号。
   * 撞车时后来的那条退回用记录 id 当身份 —— 那不是正文里的坐标，
   * 拿它去 getElementById 什么也找不到，于是点了静悄悄地毫无反应。
   *
   * 现在门牌号单独一格，**撞不撞车都指向真实起点**。
   */
  it('⚠️ 撞坐标时，身份可以退回用 id，但门牌号必须还是真实起点', () => {
    const list = buildVocabList(
      [word('w1', 'L0W0', 'all'), phrase('p1a', 'L0W0', 'L0W1', 'all right')],
      active
    )
    const 单词 = list[0]
    const 短语 = list[1]

    // 身份：照旧，撞车的那条退回用 id
    expect([单词.anchorId, 短语.anchorId]).toEqual(['L0W0', 'p1a'])
    // 门牌号：两条都指向正文里那个真实坐标 —— 这是修好的那一格
    expect([单词.startAnchorId, 短语.startAnchorId]).toEqual(['L0W0', 'L0W0'])
  })

  it('不撞车时门牌号也是真实起点（短语指向它的首词，不是末词）', () => {
    const list = buildVocabList([phrase('p1a', 'L4W5', 'L4W6', 'wanna shout')], active)
    expect(list[0].startAnchorId).toBe('L4W5')
    expect(list[0].anchorId).toBe('L4W5')
  })

  it('孤儿没有门牌号 —— 正文里已经没那个位置了，点了本来就不该跳', () => {
    const orphan: Annotation = { ...word('w9', 'L0W0', 'gone'), start: null, end: null }
    const list = buildVocabList([orphan], active)
    expect(list[0].startAnchorId).toBeUndefined()
  })

  it('多篇文档各自成段，段内按正文顺序排', () => {
    const list = buildVocabList(
      [
        { ...word('a', 'L1W0', 'second') },
        { ...word('b', 'L0W0', 'first') },
        { ...word('c', 'L0W0', 'other'), docId: 'p2' }
      ],
      new Set(['p1', 'p2'])
    )
    expect(list.filter((v) => v.pageId === 'p1').map((v) => v.word)).toEqual(['first', 'second'])
    expect(list.filter((v) => v.pageId === 'p2').map((v) => v.word)).toEqual(['other'])
  })
})
