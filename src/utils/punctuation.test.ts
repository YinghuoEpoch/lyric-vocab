import { describe, it, expect } from 'vitest'
import {
  leadingClosers,
  splitEdgePunctuation,
  stripEdgePunctuation,
  trailingOpeners
} from './punctuation'
import { tokenizeLine } from './tokenize'
import { buildWordList, getRangeText, reconcileAnnotations } from './reconcile'
import type { Annotation } from '../types'

/** 划一段范围，取出它的原文（照抄阅读页的用法） */
function slice(line: string, from: number, to: number): string {
  const words = buildWordList(line)
  return getRangeText(line, words, words[from].anchorId, words[to].anchorId)
}

describe('两头紧贴的标点', () => {
  it('往左只吃开头类，前一句的句号带不进来', () => {
    expect(trailingOpeners('He smiled. “')).toBe('“')
    expect(trailingOpeners('He smiled. ')).toBe('')
    expect(trailingOpeners('（')).toBe('')
  })

  it('往右只吃收尾类', () => {
    expect(leadingClosers(',” he said')).toBe(',”')
    expect(leadingClosers(' he said')).toBe('')
    expect(leadingClosers('."')).toBe('."')
  })
})

describe('getRangeText 把引号句号带上', () => {
  it('弯引号：整句划上，引号和句号都在', () => {
    // “(0)I (1)like (2)you,” (3)he (4)said.
    expect(slice('“I like you,” he said.', 0, 4)).toBe('“I like you,” he said.')
  })

  it('直引号一样', () => {
    expect(slice('"I like you," he said.', 0, 4)).toBe('"I like you," he said.')
  })

  it('只划引号里那半句，两个引号都配齐', () => {
    expect(slice('“I like you,” he said.', 0, 2)).toBe('“I like you,”')
  })

  it('⚠️ 前面还有一句时，前一句的句号不会被吃进来', () => {
    const line = 'He smiled. “I like you,” he said.'
    // He(0) smiled(1) I(2) like(3) you(4) he(5) said(6)
    expect(slice(line, 2, 6)).toBe('“I like you,” he said.')
    // 反过来：划前一句，句号跟着走，后面的引号不跟
    expect(slice(line, 0, 1)).toBe('He smiled.')
  })

  it('叹号、括号、省略号', () => {
    expect(slice('“I like you!” she shouted.', 0, 2)).toBe('“I like you!”')
    expect(slice('It was (as always) fine.', 2, 3)).toBe('(as always)')
    expect(slice('Well… he left.', 0, 0)).toBe('Well…')
  })

  it('原有的撇号规则没被打乱', () => {
    expect(slice("I don't know.", 0, 2)).toBe("I don't know.")
    expect(slice("the students' books", 1, 1)).toBe("students'")
    expect(slice("rock 'n' roll here", 0, 2)).toBe("rock 'n' roll")
  })

  it('原有的数字尾巴规则没被打乱', () => {
    expect(slice('He was hit in 2020', 0, 3)).toBe('He was hit in 2020')
  })

  it('没有标点时和从前一模一样', () => {
    expect(slice('I like you very much', 0, 2)).toBe('I like you')
  })
})

describe('stripEdgePunctuation（短语用）', () => {
  it('剥掉两头的引号句号', () => {
    expect(stripEdgePunctuation('“I like you,”')).toBe('I like you')
    expect(stripEdgePunctuation('he said.')).toBe('he said')
    expect(stripEdgePunctuation('(as always)')).toBe('as always')
  })

  it('中间的标点不动', () => {
    expect(stripEdgePunctuation('“I like you,” he said.')).toBe('I like you,” he said')
  })

  it('撇号不剥 —— 那是词的一部分', () => {
    expect(stripEdgePunctuation("don't")).toBe("don't")
    expect(stripEdgePunctuation("students'")).toBe("students'")
  })
})

describe('splitEdgePunctuation（正文画线用）', () => {
  const roles = (line: string) =>
    splitEdgePunctuation(tokenizeLine(line)).map((s) => `${s.edge ?? s.type}:${s.text}`)

  it('把 `. “` 拆成「归前一句的句号」和「归后一句的引号」', () => {
    expect(roles('He smiled. “I like')).toEqual([
      'en:He',
      'other: ',
      'en:smiled',
      'close:.',
      'other: ',
      'open:“',
      'en:I',
      'other: ',
      'en:like'
    ])
  })

  it('`,” ` 整串归前面那个词', () => {
    expect(roles('you,” he')).toEqual(['en:you', 'close:,”', 'other: ', 'en:he'])
  })

  it('缩写后缀不拆', () => {
    expect(roles("don't")).toEqual(['en:do', "other:n't"])
  })

  it('拆完之后，把文字接回去和原文一字不差', () => {
    for (const line of [
      'He smiled. “I like you,” he said.',
      "I don't know — it's rock 'n' roll (really).",
      '第一行中文 mixed with English, 好不好？'
    ]) {
      expect(splitEdgePunctuation(tokenizeLine(line)).map((s) => s.text).join('')).toBe(line)
    }
  })
})

describe('对账重算文字时也分两套规矩', () => {
  const OLD = 'He smiled once. “I like you,” he said.'
  // 删掉 once：范围会挪，文字得重取一遍
  const NEW = 'He smiled. “I like you,” he said.'

  const at = (over: Partial<Annotation>): Annotation => ({
    id: 'x',
    docId: 'p1',
    type: 'sentence',
    start: 'L0W3',
    end: 'L0W7',
    text: '“I like you,” he said.',
    order: 0,
    createdAt: 1,
    ...over
  })

  it('句摘重取：引号句号还在', () => {
    const r = reconcileAnnotations(OLD, NEW, [at({})])
    expect(r.annotations[0].text).toBe('“I like you,” he said.')
  })

  it('短语重取：两头剥干净（要拿去词典查录音）', () => {
    const r = reconcileAnnotations(OLD, NEW, [
      at({ type: 'phrase', start: 'L0W3', end: 'L0W5', text: 'I like you' })
    ])
    expect(r.annotations[0].text).toBe('I like you')
  })
})
