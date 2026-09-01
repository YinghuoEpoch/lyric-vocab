import { describe, it, expect } from 'vitest'
import { DEFINITION_SPEC, LEMMA_SPEC, POS_SPEC } from './fieldSpecs'
import { buildSystemPrompt } from '../mark/openaiCompatible'
import { WORD_SYSTEM_PROMPT } from './openaiCompatible'

/**
 * 钉住两条「漏了就会悄悄填错」的要求。
 *
 * 这两条都是真出过事才补上的：用户报 `what fetters my fate` 里的 `fetters`
 * 被填成了名词「羁绊」、词性 `n.`。查下来是提示词自己的毛病 ——
 * 词性那条一个字没提上下文，而变形清单里漏了第三人称单数，
 * 清单里唯一能对上词尾 `-s` 的是「复数」，等于在把模型往名词那边推。
 *
 * 这种错不会报错、不会崩，只会安静地填错一格。所以在这儿钉死。
 */

describe('词性必须从句子里判断', () => {
  it('要求里明写了「所给这句话」，不是词典里最常见的那个词性', () => {
    expect(POS_SPEC).toContain('所给这句话')
    expect(POS_SPEC).toContain('不是它在词典里最常见的那个词性')
  })

  it('给了同拼写不同词性的例子 —— 光说不给例子模型照样按词典填', () => {
    expect(POS_SPEC).toContain('fetters')
    expect(POS_SPEC).toContain('lead')
  })
})

describe('词尾 -s 不许一律当成复数', () => {
  it('变形清单里有第三人称单数', () => {
    expect(DEFINITION_SPEC).toContain('第三人称单数')
  })

  it('明写了 -s 有两种可能，由句子决定', () => {
    expect(DEFINITION_SPEC).toContain('词尾的 -s 不一定是复数')
  })

  it('释义和词性不许打架', () => {
    expect(DEFINITION_SPEC).toContain('释义必须和 pos 那一格说的词性一致')
  })

  it('还原原形也要按句子里的词性来', () => {
    expect(LEMMA_SPEC).toContain('按它在这句话里的词性还原')
  })
})

describe('填充和划词用的是同一份要求', () => {
  const markPrompt = buildSystemPrompt({ level: 'cet4', amount: 'few' })

  it('词性那条两边都用上了 —— 从前只钉了释义和原形，词性漏在外面', () => {
    expect(markPrompt).toContain(POS_SPEC)
    expect(WORD_SYSTEM_PROMPT).toContain(POS_SPEC)
  })

  it('释义那条两边也都用上了', () => {
    expect(markPrompt).toContain(DEFINITION_SPEC)
    expect(WORD_SYSTEM_PROMPT).toContain(DEFINITION_SPEC)
  })
})

describe('填充的提示词要求先读上下文', () => {
  it('明写了先读 context 再动笔', () => {
    expect(WORD_SYSTEM_PROMPT).toContain('先读 context')
    expect(WORD_SYSTEM_PROMPT).toContain('给了 context 就必须用')
  })
})
