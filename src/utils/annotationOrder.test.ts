import { describe, it, expect } from 'vitest'
import { compareAnchors, compareByText, parseAnchor, sortByText } from './annotationOrder'

/**
 * 排列次序的测试。
 *
 * 手动排序去掉之后，次序是**算**出来的：一律按正文坐标。
 * 值得钉住的是那几条平局规则 —— 孤儿沉底、同起点短的在前、
 * 以及「两台设备算出来必须一模一样」（不能靠数组本来的位置）。
 */

/** 造一条排序看得见的最小标注 */
const a = (
  id: string,
  start: string | null,
  end?: string | null,
  createdAt = 0
) => ({ id, start, end: end === undefined ? start : end, createdAt })

const ids = (list: ReturnType<typeof a>[]) => sortByText(list).map((x) => x.id)

describe('parseAnchor', () => {
  it('认得 L行W词，别的一律当作没有位置', () => {
    expect(parseAnchor('L3W12')).toEqual([3, 12])
    expect(parseAnchor('L0W0')).toEqual([0, 0])
    expect(parseAnchor(null)).toBeNull()
    expect(parseAnchor(undefined)).toBeNull()
    expect(parseAnchor('')).toBeNull()
    expect(parseAnchor('orphan:x')).toBeNull()
    expect(parseAnchor('L3')).toBeNull()
  })
})

describe('compareAnchors', () => {
  it('先比行，再比这一行里的第几个词', () => {
    expect(compareAnchors('L1W0', 'L2W0')).toBeLessThan(0)
    expect(compareAnchors('L2W0', 'L1W9')).toBeGreaterThan(0)
    expect(compareAnchors('L1W2', 'L1W10')).toBeLessThan(0)
    expect(compareAnchors('L1W2', 'L1W2')).toBe(0)
  })

  it('有一边没位置就没法比，返回 0 交给上层', () => {
    expect(compareAnchors(null, 'L1W0')).toBe(0)
  })
})

describe('按正文顺序排', () => {
  it('数组本来是什么顺序都不影响结果', () => {
    const list = [a('c', 'L2W0'), a('a', 'L0W0'), a('b', 'L1W3')]
    expect(ids(list)).toEqual(['a', 'b', 'c'])
    expect(ids([...list].reverse())).toEqual(['a', 'b', 'c'])
  })

  it('行号按数值比，不是按字符串比（L10 在 L9 后面）', () => {
    expect(ids([a('十', 'L10W0'), a('九', 'L9W0')])).toEqual(['九', '十'])
  })

  it('同一行里按第几个词，W10 在 W9 后面', () => {
    expect(ids([a('十', 'L0W10'), a('九', 'L0W9')])).toEqual(['九', '十'])
  })

  it('后标的词照样落回它在正文里的位置（从前会跑到末尾）', () => {
    // 正文是 apple and ear，先标了 apple 和 ear，回头再标 and
    const list = [a('apple', 'L0W0'), a('ear', 'L0W2'), a('and', 'L0W1')]
    expect(ids(list)).toEqual(['apple', 'and', 'ear'])
  })

  it('起点相同时短的在前：单词排在以它开头的短语前面', () => {
    const 单词 = a('word', 'L38W0')
    const 短语 = a('phrase', 'L38W0', 'L38W2')
    expect(ids([短语, 单词])).toEqual(['word', 'phrase'])
  })

  it('孤儿（正文里那段被删了）一律沉底，彼此按创建时间', () => {
    const list = [
      a('孤儿新', null, null, 200),
      a('有位置', 'L5W0'),
      a('孤儿旧', null, null, 100)
    ]
    expect(ids(list)).toEqual(['有位置', '孤儿旧', '孤儿新'])
  })

  it('起止都一样时按创建时间，再一样按 id —— 两台设备必须算出同一个次序', () => {
    const 早 = a('x', 'L1W1', 'L1W1', 100)
    const 晚 = a('y', 'L1W1', 'L1W1', 200)
    expect(ids([晚, 早])).toEqual(['x', 'y'])

    const 同时甲 = a('aaa', 'L1W1', 'L1W1', 100)
    const 同时乙 = a('bbb', 'L1W1', 'L1W1', 100)
    expect(ids([同时乙, 同时甲])).toEqual(['aaa', 'bbb'])
  })

  it('sortByText 不动传进来的那个数组', () => {
    const list = [a('c', 'L2W0'), a('a', 'L0W0')]
    sortByText(list)
    expect(list.map((x) => x.id)).toEqual(['c', 'a'])
  })

  it('compareByText 自己跟自己比是 0，反过来比符号相反', () => {
    const x = a('x', 'L1W0')
    const y = a('y', 'L2W0')
    expect(compareByText(x, x)).toBe(0)
    expect(Math.sign(compareByText(x, y))).toBe(-Math.sign(compareByText(y, x)))
  })
})
