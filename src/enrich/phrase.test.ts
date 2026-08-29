import { describe, it, expect } from 'vitest'
import { isPhraseIncomplete, mergePhraseFill } from './runner'

/**
 * 短语填充的判定与合并。
 *
 * 和单词、句子同一条底线：**只补空着的格子，用户写过的一个字都不动**。
 * 短语的两格是「释义」和「用法」，后者存在标注的 grammar 字段里。
 */

describe('短语还差什么', () => {
  it('两格都空，要填', () => {
    expect(isPhraseIncomplete({})).toBe(true)
  })

  it('只写了释义、没写用法，也算没填全', () => {
    expect(isPhraseIncomplete({ definition: '起飞' })).toBe(true)
  })

  it('两格都写了就不再打扰', () => {
    expect(isPhraseIncomplete({ definition: '起飞', grammar: '常用于飞机' })).toBe(false)
  })

  it('空白字符不算写过', () => {
    expect(isPhraseIncomplete({ definition: '  ', grammar: '  ' })).toBe(true)
  })
})

describe('只补空格', () => {
  const fill = { definition: 'AI 给的释义', grammar: 'AI 给的用法' }

  it('全空时两格都补', () => {
    expect(mergePhraseFill({}, fill)).toEqual(fill)
  })

  it('用户写过释义，就只补用法', () => {
    expect(mergePhraseFill({ definition: '我写的' }, fill)).toEqual({ grammar: 'AI 给的用法' })
  })

  it('两格都写过就没什么可补的', () => {
    expect(mergePhraseFill({ definition: 'a', grammar: 'b' }, fill)).toBeNull()
  })

  it('模型漏了一项就不写进空字符串', () => {
    expect(mergePhraseFill({}, { definition: '   ' })).toBeNull()
  })

  it('顺手去掉多余空白', () => {
    expect(mergePhraseFill({}, { definition: '  起飞  ' })).toEqual({ definition: '起飞' })
  })
})
