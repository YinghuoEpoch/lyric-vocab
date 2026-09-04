import { describe, it, expect } from 'vitest'
import { findFollowIndex } from './followScroll'

/** 一份典型的清单：第 3、12、38、53 行各一条 */
const LIST = ['L3W0', 'L12W2', 'L38W0', 'L53W1']

describe('findFollowIndex', () => {
  it('屏幕上有笔记时，落在屏幕上最后那条', () => {
    // 屏幕最后一个词在 L40W5：屏幕上有 L12、L38 → 落在 L38（索引 2）
    expect(findFollowIndex(LIST, 'L40W5')).toBe(2)
  })

  it('屏幕上一条笔记也没有时，退回屏幕上方最近的那条', () => {
    expect(findFollowIndex(LIST, 'L50W0')).toBe(2)
  })

  it('正好落在某条笔记那个词上，算它已经露出来了', () => {
    expect(findFollowIndex(LIST, 'L12W2')).toBe(1)
  })

  it('⚠️ 同一行里分得开：只差一个词序号也认', () => {
    // 这是「长段里的笔记死活被跳过」的根子。L12W2 那条要等到第 2 个词露出来才算
    expect(findFollowIndex(LIST, 'L12W1')).toBe(0)
    expect(findFollowIndex(LIST, 'L12W2')).toBe(1)
  })

  it('⚠️ 同一行上的好几条笔记，会一条一条轮流被标中', () => {
    // 一个自然段里四条笔记，从前它们共用一个行号，只有最后一条可能被标
    const sameLine = ['L7W0', 'L7W9', 'L7W20', 'L7W31']
    expect(findFollowIndex(sameLine, 'L7W0')).toBe(0)
    expect(findFollowIndex(sameLine, 'L7W15')).toBe(1)
    expect(findFollowIndex(sameLine, 'L7W25')).toBe(2)
    expect(findFollowIndex(sameLine, 'L7W99')).toBe(3)
  })

  it('一路往下读，落点只会前进不会后退', () => {
    let last = -1
    for (let line = 0; line <= 60; line++) {
      for (const w of [0, 5, 20]) {
        const i = findFollowIndex(LIST, `L${line}W${w}`)
        expect(i).toBeGreaterThanOrEqual(last)
        last = i
      }
    }
  })

  it('还没读到第一条笔记时，落在第一条上', () => {
    expect(findFollowIndex(LIST, 'L0W0')).toBe(0)
    expect(findFollowIndex(LIST, 'L2W9')).toBe(0)
  })

  it('读过了最后一条，就停在最后一条', () => {
    expect(findFollowIndex(LIST, 'L999W0')).toBe(3)
  })

  it('同一个词上起头的两条（单词 + 短语），落在后一条 —— 短语铺得更远', () => {
    expect(findFollowIndex(['L3W0', 'L38W0', 'L38W0', 'L44W0'], 'L38W0')).toBe(2)
  })

  it('孤儿（没坐标）跟不到：读到最后停在最后一条**有坐标**的上面', () => {
    expect(findFollowIndex(['L3W0', 'L38W0', null, undefined], 'L999W0')).toBe(1)
  })

  it('孤儿排在中间也不会被选中', () => {
    expect(findFollowIndex([null, 'L10W0', 'L20W0'], 'L15W0')).toBe(1)
  })

  it('一条有坐标的都没有：返回 -1，调用方据此什么也不做', () => {
    expect(findFollowIndex([null, undefined], 'L10W0')).toBe(-1)
    expect(findFollowIndex([], 'L10W0')).toBe(-1)
  })

  it('量不到屏幕位置（null）时落在第一条，不乱跳', () => {
    expect(findFollowIndex(LIST, null)).toBe(0)
    expect(findFollowIndex(LIST, 'orphan:xxx')).toBe(0)
  })
})
