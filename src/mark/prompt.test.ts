import { describe, it, expect } from 'vitest'
import { buildSystemPrompt } from './openaiCompatible'
import { DEFINITION_SPEC, LEMMA_SPEC, PHRASE_USAGE_SPEC } from '../enrich/fieldSpecs'

/**
 * 划词和填充是两条独立的提示词，却往同一批格子里写字 —— 各写各的会走样。
 * 已经走样过一次：填充要求「不是原形就在释义末尾补上原形」，划词没这一条，
 * 于是同一本书里两种写法混着出现。这里钉住「两边用的是同一份要求」。
 */
describe('划词的提示词', () => {
  const prompt = buildSystemPrompt({ level: 'cet4', amount: 'few' })

  it('单词释义的要求和「一键填充」是同一份', () => {
    expect(prompt).toContain(DEFINITION_SPEC)
  })

  it('要原形（lemma），和「一键填充」一致', () => {
    expect(prompt).toContain(LEMMA_SPEC)
    expect(prompt).toContain('补上原形')
  })

  it('短语用法的要求也是同一份', () => {
    expect(prompt).toContain(PHRASE_USAGE_SPEC)
  })

  it('难度档和数量档都写进了提示词', () => {
    expect(buildSystemPrompt({ level: 'ielts', amount: 'many' })).toContain('雅思')
    expect(buildSystemPrompt({ level: 'cet6', amount: 'medium' })).toContain('30 到 40 条')
  })

  it('「照抄原文写法」这条硬要求还在 —— 定位全靠它', () => {
    expect(prompt).toContain('原文里的确切写法')
    expect(prompt).toContain('took off')
  })
})
