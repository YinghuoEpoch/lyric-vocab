import { describe, it, expect } from 'vitest'
import { findFollowIndex } from './followScroll'

/** 一份典型的清单：第 3、12、38、53 行各一条 */
const LIST = ['L3W0', 'L12W2', 'L38W0', 'L53W1']

describe('findFollowIndex', () => {
  it('正好读到某条笔记那一行，就落在它身上', () => {
    expect(findFollowIndex(LIST, 12)).toBe(1)
    expect(findFollowIndex(LIST, 38)).toBe(2)
  })

  it('读在两条之间的空档里，落在**前面那条**上', () => {
    // 第 30 行：离第 38 行更近（差 8），但按规矩落在第 12 行那条（索引 1）
    expect(findFollowIndex(LIST, 30)).toBe(1)
  })

  it('空档正中间也不回跳 —— 一路往下读，落点只会前进不会后退', () => {
    let last = -1
    for (let line = 0; line <= 60; line++) {
      const i = findFollowIndex(LIST, line)
      expect(i).toBeGreaterThanOrEqual(last)
      last = i
    }
  })

  it('还没读到第一条笔记时，落在第一条上', () => {
    expect(findFollowIndex(LIST, 0)).toBe(0)
    expect(findFollowIndex(LIST, 2)).toBe(0)
  })

  it('传屏幕最下面那行 → 落点就是「屏幕上显示的最后一条笔记」', () => {
    // 屏幕从第 10 行露到第 40 行：上面有 12，屏幕内有 12/38 → 落在第 38 行那条
    expect(findFollowIndex(LIST, 40)).toBe(2)
    // 屏幕从第 40 行露到第 50 行：屏幕上一条笔记都没有 → 退回上方最近的第 38 行那条
    expect(findFollowIndex(LIST, 50)).toBe(2)
  })

  it('读过了最后一条，就停在最后一条', () => {
    expect(findFollowIndex(LIST, 999)).toBe(3)
  })

  it('同一行上有好几条时，落在最后那条 —— 它们都在屏幕上，落点得是确定的', () => {
    // 单词 Flying 和短语 Flying high 都从 L38 开始，排序规则让短的在前
    expect(findFollowIndex(['L3W0', 'L38W0', 'L38W0', 'L44W0'], 38)).toBe(2)
  })

  it('孤儿（没坐标）跟不到：读到最后停在最后一条**有坐标**的上面', () => {
    const withOrphans = ['L3W0', 'L38W0', null, undefined]
    expect(findFollowIndex(withOrphans, 999)).toBe(1)
  })

  it('孤儿排在中间也不会被选中', () => {
    expect(findFollowIndex([null, 'L10W0', 'L20W0'], 15)).toBe(1)
  })

  it('一条有坐标的都没有：返回 -1，调用方据此什么也不做', () => {
    expect(findFollowIndex([null, undefined], 10)).toBe(-1)
    expect(findFollowIndex([], 10)).toBe(-1)
  })

  it('全是孤儿但读到很后面，也不会硬跟到某条身上', () => {
    expect(findFollowIndex([null, null], 999)).toBe(-1)
  })

  it('坐标里的词序号不参与判断 —— 只看第几行', () => {
    // 同一行里第 0 个词和第 9 个词，读到那一行时都算「读到了」
    expect(findFollowIndex(['L5W9', 'L9W0'], 5)).toBe(0)
  })
})
