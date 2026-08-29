import { describe, it, expect } from 'vitest'
import { iconAlignFor } from './speakIconAlign'

/**
 * 喇叭图标按哪条中线摆的判定。
 *
 * 风险不在算法，在「最后一个字母」到底是哪一个 ——
 * 句子结尾有句号、单词可能带撇号或连字符，看错了图标就摆歪。
 */

describe('看结尾那个字母', () => {
  it('小写结尾按小写中线', () => {
    expect(iconAlignFor('stumble')).toBe('x')
    expect(iconAlignFor('Though')).toBe('x') // 开头大写不算，看的是结尾
  })

  it('大写结尾按大写中线', () => {
    expect(iconAlignFor('COVID')).toBe('cap')
    expect(iconAlignFor('I')).toBe('cap')
  })

  it('结尾的标点跳过，看它前面那个字母', () => {
    expect(iconAlignFor('And you are here after all.')).toBe('x')
    expect(iconAlignFor('Is it true?')).toBe('x')
    expect(iconAlignFor('“HELLO!”')).toBe('cap')
    expect(iconAlignFor('she’s')).toBe('x')
  })

  it('数字按大写算 —— 衬线字体里数字通常齐大写高', () => {
    expect(iconAlignFor('COVID-19')).toBe('cap')
    expect(iconAlignFor('1990s')).toBe('x') // 这个结尾是小写 s
  })

  it('一个字母都没有时按小写摆，和从前一致', () => {
    expect(iconAlignFor('...')).toBe('x')
    expect(iconAlignFor('')).toBe('x')
  })

  it('中文这类没有大小写之分的，不要误判成大写', () => {
    expect(iconAlignFor('中文')).toBe('x')
  })
})
