import { describe, it, expect } from 'vitest'
import { buildWordList, alignWords, reconcilePage } from './reconcile'
import type { NotesMap, Sentence } from '../types'

/**
 * 「笔记对账」的回归测试。
 *
 * 这块是全项目逻辑最绕的一处：正文被编辑之后，要把挂在坐标上的笔记搬到正确的新位置。
 * 下面每一条都对应一个真实会遇到的场景，改动这块代码后跑一遍就知道有没有弄坏。
 *
 * 跑测试：npm test
 */

const OLD = `I never stood up very tall
我从未挺起胸膛
But there were times I'd wanna shout
但我也曾想放声呐喊`

/** 把 notes 摊平成 [坐标, 单词] 便于断言 */
const flat = (notes: NotesMap) =>
  Object.entries(notes)
    .map(([anchorId, n]) => [anchorId, n.word] as [string, string])
    .sort()

const note = (word: string, extra: Partial<NotesMap[string]> = {}): NotesMap[string] => ({
  word,
  ...extra
})

const sentence = (over: Partial<Sentence> = {}): Sentence => ({
  id: 's1',
  text: 'there were times',
  grammar: '',
  meaning: '',
  docId: 'p1',
  startAnchorId: 'L2W1',
  endAnchorId: 'L2W3',
  date: 1,
  ...over
})

describe('buildWordList', () => {
  it('只收英文词，编号按「第几行第几个词」且逐行重新计数', () => {
    expect(buildWordList('I never stood\n中文\nBut there')).toEqual([
      { anchorId: 'L0W0', word: 'I' },
      { anchorId: 'L0W1', word: 'never' },
      { anchorId: 'L0W2', word: 'stood' },
      { anchorId: 'L2W0', word: 'But' },
      { anchorId: 'L2W1', word: 'there' }
    ])
  })
})

describe('alignWords', () => {
  it('完全没变时一一对应', () => {
    expect(alignWords(['a', 'b', 'c'], ['a', 'b', 'c'])).toEqual([0, 1, 2])
  })

  it('开头插入词时整体后移', () => {
    expect(alignWords(['a', 'b'], ['x', 'y', 'a', 'b'])).toEqual([2, 3])
  })

  it('删掉的词标记为 null，其余仍能对上', () => {
    expect(alignWords(['a', 'b', 'c'], ['a', 'c'])).toEqual([0, null, 1])
  })

  it('大小写变化不影响匹配', () => {
    expect(alignWords(['Stood'], ['stood'])).toEqual([0])
  })

  it('重复词按序列位置对齐，不会都挤到第一个', () => {
    // 删掉第 2 个 the：剩下的两个 the 应分别对应第 1 个和第 3 个
    expect(alignWords(['the', 'the', 'the'], ['the', 'the'])).toEqual([0, 1, null])
  })
})

describe('reconcilePage：单词笔记', () => {
  it('删掉被标记的词，同行后面的笔记正确前移，不会被顶替', () => {
    const NEW = OLD.replace('never stood up', 'never up')
    const notes = { L0W2: note('stood', { definition: '站立' }), L0W3: note('up') }
    const r = reconcilePage(OLD, NEW, notes, [])

    expect(r.newOrphanNotes.map((n) => n.word)).toEqual(['stood'])
    // up 从 L0W3 前移到 L0W2，而不是让 stood 的笔记霸占 L0W2
    expect(flat(r.notes)).toEqual([['L0W2', 'up']])
  })

  it('删掉行内最后一个英文词（后面是汉字或行尾）也能识别为孤儿', () => {
    const NEW = OLD.replace('very tall', 'very')
    const r = reconcilePage(OLD, NEW, { L0W5: note('tall', { definition: '高的' }) }, [])

    expect(r.newOrphanNotes.map((n) => n.word)).toEqual(['tall'])
    expect(flat(r.notes)).toEqual([])
  })

  it('在文档前面插入一行时，所有笔记整体跟随，且不产生任何孤儿', () => {
    const NEW = 'A brand new line\n' + OLD
    const notes = { L0W2: note('stood'), L2W3: note('times') }
    const r = reconcilePage(OLD, NEW, notes, [])

    expect(r.newOrphanNotes).toEqual([])
    expect(flat(r.notes)).toEqual([
      ['L1W2', 'stood'],
      ['L3W3', 'times']
    ])
  })

  it('重复单词各归各位，不会张冠李戴', () => {
    const text = 'the cat and the dog and the bird'
    const notes = { L0W3: note('the'), L0W6: note('the') }

    const same = reconcilePage(text, text, notes, [])
    expect(flat(same.notes)).toEqual([
      ['L0W3', 'the'],
      ['L0W6', 'the']
    ])

    // 删掉第 3 个 the：第 2 个的笔记原地不动，第 3 个的成为孤儿
    const removed = reconcilePage(text, 'the cat and the dog and bird', notes, [])
    expect(flat(removed.notes)).toEqual([['L0W3', 'the']])
    expect(removed.newOrphanNotes).toHaveLength(1)
  })

  it('正文没有任何改动时 changed 为 false，不去惊动上层', () => {
    const r = reconcilePage(OLD, OLD, { L0W2: note('stood') }, [])
    expect(r.changed).toBe(false)
  })
})

describe('reconcilePage：已标记「原文已删除」的笔记', () => {
  it('不会再次进入待确认列表，避免每次编辑都重复打扰用户', () => {
    const NEW = OLD.replace('very tall', 'very')
    // L0W5 已经是孤儿并被用户选择保留
    const notes = { L0W5: note('tall', { orphaned: true }) }
    const r = reconcilePage(NEW, NEW + '\nmore text here', notes, [])

    expect(r.newOrphanNotes).toEqual([])
    expect(r.notes.L0W5?.orphaned).toBe(true)
  })

  it('原文里重新出现该词时自动重新挂上并清掉标记', () => {
    const WITHOUT = OLD.replace('very tall', 'very')
    const notes = { L0W5: note('tall', { orphaned: true, definition: '高的' }) }
    // 用户把 tall 又打回去了
    const r = reconcilePage(WITHOUT, OLD, notes, [])

    expect(r.newOrphanNotes).toEqual([])
    expect(flat(r.notes)).toEqual([['L0W5', 'tall']])
    expect(r.notes.L0W5?.orphaned).toBeUndefined()
    expect(r.notes.L0W5?.definition).toBe('高的') // 释义没丢
  })

  it('救回时不会抢走已经被别的笔记占用的位置', () => {
    const text = 'alpha beta alpha'
    // L0W0 正常挂着，L0W2 是孤儿且拼写相同 —— 只能落到还空着的 L0W2
    const notes = { L0W0: note('alpha'), L0W2: note('alpha', { orphaned: true }) }
    const r = reconcilePage(text, text, notes, [])

    expect(flat(r.notes)).toEqual([
      ['L0W0', 'alpha'],
      ['L0W2', 'alpha']
    ])
  })
})

describe('reconcilePage：句摘', () => {
  it('正文位移后句摘范围自动跟随，显示文字重新取准', () => {
    const NEW = 'A brand new line\n' + OLD
    const r = reconcilePage(OLD, NEW, {}, [sentence()])

    expect(r.sentences).toHaveLength(1)
    expect(r.sentences[0].startAnchorId).toBe('L3W1')
    expect(r.sentences[0].endAnchorId).toBe('L3W3')
    expect(r.sentences[0].text).toBe('there were times')
  })

  it('整句被删掉时进入待确认列表', () => {
    const NEW = OLD.replace('But there were times ', 'But ')
    const r = reconcilePage(OLD, NEW, {}, [sentence()])

    expect(r.sentences).toHaveLength(0)
    expect(r.newOrphanSentences).toHaveLength(1)
  })

  it('只剩一头（起点或终点没了）也算不完整，进入待确认列表', () => {
    const NEW = OLD.replace('there were times', 'there were')
    const r = reconcilePage(OLD, NEW, {}, [sentence()])

    expect(r.newOrphanSentences).toHaveLength(1)
  })

  it('已标记的句摘原文重新出现时自动重新框定并清掉标记', () => {
    const WITHOUT = OLD.replace('But there were times ', 'But ')
    const orphan = sentence({ orphaned: true })
    const r = reconcilePage(WITHOUT, OLD, {}, [orphan])

    expect(r.newOrphanSentences).toEqual([])
    expect(r.sentences[0].orphaned).toBeUndefined()
    expect(r.sentences[0].startAnchorId).toBe('L2W1')
    expect(r.sentences[0].endAnchorId).toBe('L2W3')
  })
})
