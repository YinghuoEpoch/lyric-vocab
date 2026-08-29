import { describe, it, expect } from 'vitest'
import { locateMarks } from './locate'
import type { MarkPick } from './types'

/**
 * 定位是「一键划词」真正的难点：AI 返回的是文字，标注要挂在坐标上。
 * 这里钉住的是那三种翻车方式 —— 给原形、行号记错、编一个不存在的词 ——
 * 都必须**如实跳过**，绝不能猜到别的词头上去。
 */

const content = [
  'He stood up and took off his hat', // L0
  '他站起来摘下帽子', // L1
  "She doesn't know the meaning of it", // L2
  'The bird stood on a wire and stood again' // L3
].join('\n')

const pick = (p: Partial<MarkPick> & Pick<MarkPick, 'line' | 'text'>): MarkPick => ({
  kind: 'word',
  ...p
})

describe('定位：正常命中', () => {
  it('单词按行内的确切写法找到坐标', () => {
    const r = locateMarks(content, [pick({ line: 0, text: 'stood' })])
    expect(r.skipped).toEqual([])
    expect(r.located).toHaveLength(1)
    expect(r.located[0].startAnchorId).toBe('L0W1')
    expect(r.located[0].endAnchorId).toBe('L0W1')
    expect(r.located[0].kind).toBe('word')
  })

  it('短语跨几个词，首尾坐标都对', () => {
    const r = locateMarks(content, [pick({ line: 0, text: 'took off', kind: 'phrase' })])
    expect(r.located[0].startAnchorId).toBe('L0W4')
    expect(r.located[0].endAnchorId).toBe('L0W5')
    expect(r.located[0].text).toBe('took off')
    expect(r.located[0].kind).toBe('phrase')
  })

  it('大小写不一致也认（一律以正文的写法为准）', () => {
    const r = locateMarks(content, [pick({ line: 0, text: 'STOOD' })])
    expect(r.located).toHaveLength(1)
    expect(r.located[0].text).toBe('stood')
  })

  it('两种撇号都认', () => {
    const r = locateMarks(content, [pick({ line: 2, text: 'doesn’t' })])
    expect(r.located).toHaveLength(1)
    expect(r.located[0].startAnchorId).toBe('L2W1')
  })
})

describe('定位：AI 说错时如实跳过，不去猜', () => {
  it('给了原形而正文是变形 —— 跳过，不去匹配别的词', () => {
    // 正文是 took off，AI 给 take off
    const r = locateMarks(content, [pick({ line: 0, text: 'take off', kind: 'phrase' })])
    expect(r.located).toEqual([])
    expect(r.skipped[0].reason).toBe('not-found')
  })

  it('行号记错 —— 只认它自己给的那一行，不全文搜', () => {
    // meaning 确实在文里（L2），但 AI 说在 L0
    const r = locateMarks(content, [pick({ line: 0, text: 'meaning' })])
    expect(r.located).toEqual([])
    expect(r.skipped[0].reason).toBe('not-found')
  })

  it('编了一个文里没有的词 —— 跳过', () => {
    const r = locateMarks(content, [pick({ line: 0, text: 'serendipity' })])
    expect(r.skipped[0].reason).toBe('not-found')
  })

  it('行号根本不存在 —— 跳过', () => {
    const r = locateMarks(content, [pick({ line: 99, text: 'stood' })])
    expect(r.skipped[0].reason).toBe('not-found')
  })

  it('给了一串没有英文词的东西 —— 跳过', () => {
    const r = locateMarks(content, [pick({ line: 1, text: '站起来' })])
    expect(r.skipped[0].reason).toBe('not-found')
  })

  it('短语的词序对不上 —— 跳过（必须是连续且同序的）', () => {
    const r = locateMarks(content, [pick({ line: 0, text: 'off took', kind: 'phrase' })])
    expect(r.skipped[0].reason).toBe('not-found')
  })

  it('短语的词各自都在、但中间隔着别的词 —— 跳过', () => {
    const r = locateMarks(content, [pick({ line: 0, text: 'stood took', kind: 'phrase' })])
    expect(r.skipped[0].reason).toBe('not-found')
  })
})

describe('定位：同一个词一篇里只划一次', () => {
  it('同一批里重复挑了同一个词，只留第一条', () => {
    const r = locateMarks(content, [
      pick({ line: 0, text: 'stood' }),
      pick({ line: 3, text: 'stood' })
    ])
    expect(r.located).toHaveLength(1)
    expect(r.located[0].startAnchorId).toBe('L0W1')
    expect(r.skipped[0].reason).toBe('already-marked')
  })

  it('用户已经手标过的词不再划', () => {
    const r = locateMarks(content, [pick({ line: 0, text: 'stood' })], new Set(['stood']))
    expect(r.located).toEqual([])
    expect(r.skipped[0].reason).toBe('already-marked')
  })

  it('一行里同一个词出现两次，取第一次那个坐标', () => {
    const r = locateMarks(content, [pick({ line: 3, text: 'stood' })])
    expect(r.located[0].startAnchorId).toBe('L3W2')
  })
})

describe('定位：kind 按实际占了几个词算，不听 AI 的', () => {
  it('AI 说是短语，实际只占一个词 -> 当单词', () => {
    const r = locateMarks(content, [pick({ line: 0, text: 'stood', kind: 'phrase' })])
    expect(r.located[0].kind).toBe('word')
  })

  it('AI 说是单词，实际占两个词 -> 当短语', () => {
    const r = locateMarks(content, [pick({ line: 0, text: 'took off', kind: 'word' })])
    expect(r.located[0].kind).toBe('phrase')
  })
})

describe('定位：报数如实', () => {
  it('挑了 4 个、划上 2 个、2 个没对上', () => {
    const r = locateMarks(content, [
      pick({ line: 0, text: 'stood' }),
      pick({ line: 0, text: 'take off', kind: 'phrase' }),
      pick({ line: 2, text: 'meaning' }),
      pick({ line: 0, text: 'nonexistent' })
    ])
    expect(r.located).toHaveLength(2)
    expect(r.skipped).toHaveLength(2)
  })
})
