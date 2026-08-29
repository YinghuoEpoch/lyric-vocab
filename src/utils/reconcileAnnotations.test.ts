import { describe, it, expect } from 'vitest'
import { reconcileAnnotations, markAnnotationOrphaned } from './reconcile'
import type { Annotation } from '../types'

/**
 * 标注模型下的「对账」回归测试。
 *
 * 这里逐条对应 reconcile.test.ts 里旧模型的场景 —— 换了记录方式之后，
 * 用户能看见的行为必须一模一样。旧的那份测试是这份的验收标准。
 */

const OLD = `I never stood up very tall
我从未挺起胸膛
But there were times I'd wanna shout
但我也曾想放声呐喊`

const word = (id: string, text: string, at: string, over: Partial<Annotation> = {}): Annotation => ({
  id,
  docId: 'p1',
  type: 'word',
  start: at,
  end: at,
  text,
  order: 0,
  createdAt: 1,
  ...over
})

const range = (over: Partial<Annotation> = {}): Annotation => ({
  id: 's1',
  docId: 'p1',
  type: 'sentence',
  start: 'L2W1',
  end: 'L2W3',
  text: 'there were times',
  order: 0,
  createdAt: 1,
  ...over
})

/** 摊平成 [位置, 文字] 便于断言；孤儿的位置显示为 null */
const flat = (list: Annotation[]) =>
  list.map((a) => [a.start, a.text] as [string | null, string]).sort()

describe('单词标注', () => {
  it('删掉被标记的词，同行后面的标注正确前移，不会被顶替', () => {
    const NEW = OLD.replace('never stood up', 'never up')
    const r = reconcileAnnotations(OLD, NEW, [
      word('a', 'stood', 'L0W2', { definition: '站立' }),
      word('b', 'up', 'L0W3')
    ])

    expect(r.newOrphans.map((a) => a.text)).toEqual(['stood'])
    // up 从 L0W3 前移到 L0W2，而不是让 stood 霸占 L0W2
    expect(flat(r.annotations)).toEqual([['L0W2', 'up']])
  })

  it('删掉行内最后一个英文词（后面是汉字或行尾）也能识别为孤儿', () => {
    const NEW = OLD.replace('very tall', 'very')
    const r = reconcileAnnotations(OLD, NEW, [word('a', 'tall', 'L0W5', { definition: '高的' })])

    expect(r.newOrphans.map((a) => a.text)).toEqual(['tall'])
    expect(r.annotations).toEqual([])
  })

  it('在文档前面插入一行时，全部跟随，且不产生任何孤儿', () => {
    const NEW = 'A brand new line\n' + OLD
    const r = reconcileAnnotations(OLD, NEW, [
      word('a', 'stood', 'L0W2'),
      word('b', 'times', 'L2W3')
    ])

    expect(r.newOrphans).toEqual([])
    expect(flat(r.annotations)).toEqual([
      ['L1W2', 'stood'],
      ['L3W3', 'times']
    ])
  })

  it('重复单词各归各位，不会张冠李戴', () => {
    const text = 'the cat and the dog and the bird'
    const notes = [word('a', 'the', 'L0W3'), word('b', 'the', 'L0W6')]

    const same = reconcileAnnotations(text, text, notes)
    expect(flat(same.annotations)).toEqual([
      ['L0W3', 'the'],
      ['L0W6', 'the']
    ])

    // 删掉第 3 个 the：第 2 个原地不动，第 3 个成为孤儿
    const removed = reconcileAnnotations(text, 'the cat and the dog and bird', notes)
    expect(flat(removed.annotations)).toEqual([['L0W3', 'the']])
    expect(removed.newOrphans).toHaveLength(1)
    expect(removed.newOrphans[0].id).toBe('b')
  })

  it('正文没有任何改动时 changed 为 false，不去惊动上层', () => {
    const r = reconcileAnnotations(OLD, OLD, [word('a', 'stood', 'L0W2')])
    expect(r.changed).toBe(false)
  })
})

describe('已经是孤儿的标注', () => {
  const orphan = (id: string, text: string, over: Partial<Annotation> = {}): Annotation =>
    word(id, text, 'unused', { start: null, end: null, ...over })

  it('不会再次进入待确认列表，避免每次编辑都重复打扰用户', () => {
    const NEW = OLD.replace('very tall', 'very')
    const r = reconcileAnnotations(NEW, NEW + '\nmore text here', [orphan('a', 'tall')])

    expect(r.newOrphans).toEqual([])
    expect(r.annotations).toHaveLength(1)
    expect(r.annotations[0].start).toBeNull()
    expect(r.annotations[0].text).toBe('tall')
  })

  it('原文里重新出现该词时自动重新挂上，释义不丢', () => {
    const WITHOUT = OLD.replace('very tall', 'very')
    const r = reconcileAnnotations(WITHOUT, OLD, [orphan('a', 'tall', { definition: '高的' })])

    expect(r.newOrphans).toEqual([])
    expect(r.annotations[0].start).toBe('L0W5')
    expect(r.annotations[0].definition).toBe('高的')
    expect(r.annotations[0].id).toBe('a') // 还是同一条
  })

  it('救回时不会抢走已经被别的标注占用的位置', () => {
    const text = 'alpha beta alpha'
    // L0W0 正常挂着，另一条同名的是孤儿 —— 只能落到还空着的 L0W2
    const r = reconcileAnnotations(text, text, [
      word('a', 'alpha', 'L0W0'),
      orphan('b', 'alpha')
    ])

    expect(flat(r.annotations)).toEqual([
      ['L0W0', 'alpha'],
      ['L0W2', 'alpha']
    ])
  })

  it('句摘范围盖着的单词，不会因为范围占位而救不回来', () => {
    // 「there were times」这条句摘罩着 there / were / times 三个词，
    // 若把范围也算作「占用」，被救的 were 就没地方落了
    const r = reconcileAnnotations(OLD, OLD, [range(), orphan('w', 'were')])

    const revived = r.annotations.find((a) => a.id === 'w')
    expect(revived!.start).toBe('L2W2')
  })
})

describe('句摘（范围标注）', () => {
  it('正文位移后范围自动跟随，显示文字重新取准', () => {
    const NEW = 'A brand new line\n' + OLD
    const r = reconcileAnnotations(OLD, NEW, [range()])

    expect(r.annotations).toHaveLength(1)
    expect(r.annotations[0].start).toBe('L3W1')
    expect(r.annotations[0].end).toBe('L3W3')
    expect(r.annotations[0].text).toBe('there were times')
  })

  it('整句被删掉时进入待确认列表', () => {
    const NEW = OLD.replace('But there were times ', 'But ')
    const r = reconcileAnnotations(OLD, NEW, [range()])

    expect(r.annotations).toHaveLength(0)
    expect(r.newOrphans).toHaveLength(1)
  })

  it('删掉最后一个词时范围往里收缩，不再整条报废', () => {
    const NEW = OLD.replace('there were times', 'there were')
    const r = reconcileAnnotations(OLD, NEW, [range()])

    expect(r.newOrphans).toEqual([])
    expect(r.annotations[0].text).toBe('there were')
    expect(r.annotations[0].end).toBe('L2W2')
  })

  it('删掉第一个词时同样往里收缩', () => {
    const NEW = OLD.replace('But there were times', 'But were times')
    const r = reconcileAnnotations(OLD, NEW, [range()])

    expect(r.newOrphans).toEqual([])
    expect(r.annotations[0].text).toBe('were times')
  })

  it('删掉中间的词时范围照样收缩，文字重新取准', () => {
    const NEW = OLD.replace('there were times', 'there times')
    const r = reconcileAnnotations(OLD, NEW, [range()])

    expect(r.newOrphans).toEqual([])
    expect(r.annotations[0].text).toBe('there times')
  })

  it('范围内只剩一个词时判定为没了（一个词不成句）', () => {
    const NEW = OLD.replace('there were times', 'times')
    const r = reconcileAnnotations(OLD, NEW, [range()])

    expect(r.annotations).toHaveLength(0)
    expect(r.newOrphans).toHaveLength(1)
  })

  it('已标记的句摘原文重新出现时自动重新框定', () => {
    const WITHOUT = OLD.replace('But there were times ', 'But ')
    const r = reconcileAnnotations(WITHOUT, OLD, [range({ start: null, end: null })])

    expect(r.newOrphans).toEqual([])
    expect(r.annotations[0].start).toBe('L2W1')
    expect(r.annotations[0].end).toBe('L2W3')
  })
})

describe('新模型消掉的那些事故', () => {
  it('孤儿不再需要假坐标 —— 位置就是 null', () => {
    const NEW = OLD.replace('never stood up', 'never up')
    const r = reconcileAnnotations(OLD, NEW, [word('a', 'stood', 'L0W2')])

    const kept = markAnnotationOrphaned(r.newOrphans[0])
    expect(kept.start).toBeNull()
    expect(kept.end).toBeNull()
    expect(kept.id).toBe('a')
    expect(kept.text).toBe('stood')
  })

  it('保留的孤儿与占了它老位置的那条标注共存，不会互相覆盖', () => {
    const NEW = OLD.replace('never stood up', 'never up')
    const r = reconcileAnnotations(OLD, NEW, [
      word('a', 'stood', 'L0W2'),
      word('b', 'up', 'L0W3')
    ])

    // 模拟用户选「保留」
    const written = [...r.annotations, ...r.newOrphans.map(markAnnotationOrphaned)]
    expect(written.map((a) => a.text).sort()).toEqual(['stood', 'up'])
    expect(written.find((a) => a.start === 'L0W2')!.text).toBe('up')
    expect(written.find((a) => a.id === 'a')!.start).toBeNull()
  })

  it('身份自始至终不变：搬家、收缩、变孤儿、再救回，id 都是同一个', () => {
    const moved = reconcileAnnotations(OLD, 'A new line\n' + OLD, [word('a', 'stood', 'L0W2')])
    expect(moved.annotations[0].id).toBe('a')

    const gone = reconcileAnnotations(OLD, OLD.replace('stood ', ''), [word('a', 'stood', 'L0W2')])
    expect(gone.newOrphans[0].id).toBe('a')

    const back = reconcileAnnotations(
      OLD.replace('stood ', ''),
      OLD,
      [markAnnotationOrphaned(gone.newOrphans[0])]
    )
    expect(back.annotations[0].id).toBe('a')
    expect(back.annotations[0].start).toBe('L0W2')
  })
})

describe('句摘被改短：原句要留住，且改回来能自愈', () => {
  /** 「Is to wish my life away」那种六个词的句摘，删掉不同位置的词 */
  const SENT = `Is to wish my life away
只是在虚度光阴`
  const sent = (over: Partial<Annotation> = {}): Annotation => ({
    id: 's1',
    docId: 'p1',
    type: 'sentence',
    start: 'L0W0',
    end: 'L0W5',
    text: 'Is to wish my life away',
    order: 0,
    createdAt: 1,
    ...over
  })

  it('删掉句尾的词：范围往里收，但当初那一句记在 sourceText 里没丢', () => {
    const CUT = SENT.replace('my life away', 'my life')
    const r = reconcileAnnotations(SENT, CUT, [sent()])
    const a = r.annotations[0]

    expect(a.text).toBe('Is to wish my life') // 卡片上显示的跟着正文走
    expect(a.sourceText).toBe('Is to wish my life away') // 原句留着
    expect(a.end).toBe('L0W4')
  })

  it('把句尾的词打回正文：整条还原，记号清掉', () => {
    const CUT = SENT.replace('my life away', 'my life')
    const shrunk = reconcileAnnotations(SENT, CUT, [sent()]).annotations[0]

    const r = reconcileAnnotations(CUT, SENT, [shrunk])
    const a = r.annotations[0]

    expect(a.text).toBe('Is to wish my life away')
    expect(a.start).toBe('L0W0')
    expect(a.end).toBe('L0W5')
    expect(a.sourceText).toBeUndefined()
  })

  it('删句首的词也一样能还原（从前这里和句尾一样是死路）', () => {
    const CUT = SENT.replace('Is to wish', 'to wish')
    const shrunk = reconcileAnnotations(SENT, CUT, [sent()]).annotations[0]
    expect(shrunk.sourceText).toBe('Is to wish my life away')

    const back = reconcileAnnotations(CUT, SENT, [shrunk]).annotations[0]
    expect(back.text).toBe('Is to wish my life away')
    expect(back.sourceText).toBeUndefined()
  })

  it('删中间的词同样记号、同样能还原', () => {
    const CUT = SENT.replace('wish my life', 'wish life')
    const shrunk = reconcileAnnotations(SENT, CUT, [sent()]).annotations[0]
    expect(shrunk.text).toBe('Is to wish life away')
    expect(shrunk.sourceText).toBe('Is to wish my life away')

    const back = reconcileAnnotations(CUT, SENT, [shrunk]).annotations[0]
    expect(back.text).toBe('Is to wish my life away')
    expect(back.sourceText).toBeUndefined()
  })

  it('连缩两次，sourceText 始终是最初那一句，不是上一次缩完的样子', () => {
    const CUT1 = SENT.replace('my life away', 'my life')
    const once = reconcileAnnotations(SENT, CUT1, [sent()]).annotations[0]

    const CUT2 = CUT1.replace('Is to wish', 'to wish')
    const twice = reconcileAnnotations(CUT1, CUT2, [once]).annotations[0]

    expect(twice.text).toBe('to wish my life')
    expect(twice.sourceText).toBe('Is to wish my life away') // 不是 'Is to wish my life'
  })

  it('缩过之后整条都没了，用户选保留；原句回来时按原句还原', () => {
    const CUT = SENT.replace('my life away', 'my life')
    const shrunk = reconcileAnnotations(SENT, CUT, [sent()]).annotations[0]

    // 整行删光 -> 变孤儿
    const GONE = '只是在虚度光阴'
    const r = reconcileAnnotations(CUT, GONE, [shrunk])
    expect(r.newOrphans).toHaveLength(1)
    const orphan = markAnnotationOrphaned(r.newOrphans[0])
    expect(orphan.sourceText).toBe('Is to wish my life away') // 保留时原句还在

    // 原句整句回来
    const back = reconcileAnnotations(GONE, SENT, [orphan]).annotations[0]
    expect(back.text).toBe('Is to wish my life away')
    expect(back.start).toBe('L0W0')
    expect(back.sourceText).toBeUndefined()
  })

  it('正文没动过的句摘不会平白多出 sourceText', () => {
    const r = reconcileAnnotations(SENT, SENT, [sent()])
    expect(r.changed).toBe(false)
    expect(r.annotations[0].sourceText).toBeUndefined()
  })

  it('整条只是位移（前面插一行），不算改过，不加记号', () => {
    const MOVED = 'A brand new line\n' + SENT
    const a = reconcileAnnotations(SENT, MOVED, [sent()]).annotations[0]
    expect(a.text).toBe('Is to wish my life away')
    expect(a.start).toBe('L1W0')
    expect(a.sourceText).toBeUndefined()
  })
})
