import { describe, it, expect } from 'vitest'
import { DEFAULT_MARK_OPTIONS, parseStoredMarkOptions } from './options'

/** 认不出的一律退回默认档 —— 存的东西坏了不该让这个功能整个用不了 */
describe('记住上次选的档', () => {
  it('没存过时给默认档', () => {
    expect(parseStoredMarkOptions(null)).toEqual(DEFAULT_MARK_OPTIONS)
    expect(parseStoredMarkOptions('')).toEqual(DEFAULT_MARK_OPTIONS)
  })

  it('存了就读得回来', () => {
    expect(parseStoredMarkOptions(JSON.stringify({ level: 'ielts', amount: 'many' }))).toEqual({
      level: 'ielts',
      amount: 'many'
    })
  })

  it('存的值不认识时退回默认', () => {
    expect(parseStoredMarkOptions(JSON.stringify({ level: '八级', amount: 'x' }))).toEqual(
      DEFAULT_MARK_OPTIONS
    )
  })

  it('存的根本不是 JSON 时也不炸', () => {
    expect(parseStoredMarkOptions('{{{')).toEqual(DEFAULT_MARK_OPTIONS)
  })

  it('只存了一半时，另一半用默认', () => {
    expect(parseStoredMarkOptions(JSON.stringify({ level: 'cet6' }))).toEqual({
      level: 'cet6',
      amount: DEFAULT_MARK_OPTIONS.amount
    })
  })
})
