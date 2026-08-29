import { describe, it, expect } from 'vitest'
import { collectPicks } from './parse'

/**
 * 模型返回的东西什么样都有。这一层的职责只有一个：
 * **认不出的条目丢掉，绝不抛错** —— 一条格式不对不该让整批白跑。
 */

describe('收 pick：正常情况', () => {
  it('标准形状', () => {
    const r = collectPicks({
      picks: [
        { line: 2, text: 'stumbled', kind: 'word', phonetic: '/x/', pos: 'v.', definition: '绊倒' },
        { line: 4, text: 'took off', kind: 'phrase', definition: '脱下', usage: '后接衣物' }
      ]
    })
    expect(r).toHaveLength(2)
    expect(r[0]).toEqual({
      line: 2,
      text: 'stumbled',
      kind: 'word',
      phonetic: '/x/',
      pos: 'v.',
      definition: '绊倒'
    })
    expect(r[1].kind).toBe('phrase')
    expect(r[1].usage).toBe('后接衣物')
  })

  it('原形（lemma）也收下来 —— 和「一键填充」存进同一个字段', () => {
    const r = collectPicks({ picks: [{ line: 0, text: 'stood', lemma: 'stand' }] })
    expect(r[0].lemma).toBe('stand')
  })

  it('模型直接给一个数组，不包在 picks 里 —— 也认', () => {
    const r = collectPicks([{ line: 0, text: 'stood' }])
    expect(r).toHaveLength(1)
  })

  it('行号给成字符串 —— 也认', () => {
    const r = collectPicks({ picks: [{ line: '7', text: 'stood' }] })
    expect(r[0].line).toBe(7)
  })

  it('kind 没给或给了别的值，一律先当单词（真正算数的是定位时占了几个词）', () => {
    const r = collectPicks({ picks: [{ line: 0, text: 'a' }, { line: 0, text: 'b', kind: '词' }] })
    expect(r.map((p) => p.kind)).toEqual(['word', 'word'])
  })

  it('空字段不留下来，免得把空串写进笔记', () => {
    const r = collectPicks({ picks: [{ line: 0, text: 'stood', definition: '   ', pos: '' }] })
    expect(r[0].definition).toBeUndefined()
    expect(r[0].pos).toBeUndefined()
  })

  it('前后空格一律去掉', () => {
    const r = collectPicks({ picks: [{ line: 0, text: '  stood  ', definition: ' 站立 ' }] })
    expect(r[0].text).toBe('stood')
    expect(r[0].definition).toBe('站立')
  })
})

describe('收 pick：垃圾一律丢掉，不抛错', () => {
  it('整个不是对象', () => {
    expect(collectPicks(null)).toEqual([])
    expect(collectPicks('随便一句话')).toEqual([])
    expect(collectPicks(undefined)).toEqual([])
  })

  it('picks 不是数组', () => {
    expect(collectPicks({ picks: '没有' })).toEqual([])
  })

  it('缺行号 / 缺原文的条目丢掉，其余照收', () => {
    const r = collectPicks({
      picks: [
        { text: 'stood' },
        { line: 1 },
        { line: -1, text: 'x' },
        { line: 1.5, text: 'y' },
        null,
        'junk',
        { line: 3, text: 'good' }
      ]
    })
    expect(r).toHaveLength(1)
    expect(r[0].text).toBe('good')
  })
})
