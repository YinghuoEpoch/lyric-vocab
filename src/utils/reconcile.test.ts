import { describe, it, expect } from 'vitest'
import { buildWordList, alignWords } from './reconcile'

/**
 * 对账用到的两个底层零件的回归测试。
 *
 * 「对账应该怎么表现」的完整说明书在 reconcileAnnotations.test.ts —— 那里按
 * 真实场景一条条列着（删词、插行、重复词、孤儿救回……）。这个文件只管两件小事：
 * 正文怎么切成词表（buildWordList），以及新旧两份词表怎么对齐（alignWords）。
 * 分开是因为这两个零件不止对账在用，阅读页和一键填充也直接调 buildWordList。
 *
 * 跑测试：npm test
 */

describe('buildWordList', () => {
  it('只收英文词，编号按「第几行第几个词」且逐行重新计数', () => {
    expect(
      buildWordList('I never stood\n中文\nBut there').map((w) => [w.anchorId, w.word])
    ).toEqual([
      ['L0W0', 'I'],
      ['L0W1', 'never'],
      ['L0W2', 'stood'],
      ['L2W0', 'But'],
      ['L2W1', 'there']
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
