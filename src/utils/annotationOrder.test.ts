import { describe, it, expect } from 'vitest'
import { compareAnchors, insertionOrder, parseAnchor } from './annotationOrder'

/**
 * 新标注插在哪的测试。
 *
 * 风险有两处：一是插错位置（用户要的就是「apple 和 ear 中间」），
 * 二是把别人已经拖好的顺序冲掉 —— 后者更难发现，所以专门测。
 */

/** 造一条标注：坐标 + 当前顺序 */
const a = (start: string | null, order: number) => ({ start, order })

/** 把新标注按算出来的 order 插进去，得到最终的显示顺序，好肉眼核对 */
function 插入后顺序(existing: Array<{ start: string | null; order: number; name: string }>, start: string, name: string) {
  const order = insertionOrder(existing, start)
  return [...existing, { start, order, name }]
    .sort((x, y) => x.order - y.order)
    .map((x) => x.name)
}

describe('解析与比较坐标', () => {
  it('L0W2 是第 0 行第 2 个词', () => {
    expect(parseAnchor('L0W2')).toEqual([0, 2])
  })

  it('孤儿标注没有坐标', () => {
    expect(parseAnchor(null)).toBeNull()
    expect(parseAnchor('orphan:xyz')).toBeNull()
  })

  it('先比行，再比这一行里的第几个词', () => {
    expect(compareAnchors('L0W1', 'L0W2')).toBeLessThan(0)
    expect(compareAnchors('L2W0', 'L1W9')).toBeGreaterThan(0)
    expect(compareAnchors('L1W3', 'L1W3')).toBe(0)
  })
})

describe('按正文顺序插进去', () => {
  it('用户的例子：apple and ear，后标的 and 落在两者中间', () => {
    const existing = [
      { ...a('L0W0', 0), name: 'apple' },
      { ...a('L0W2', 1), name: 'ear' }
    ]
    expect(插入后顺序(existing, 'L0W1', 'and')).toEqual(['apple', 'and', 'ear'])
  })

  it('本来就在最后的，仍然排最后', () => {
    const existing = [
      { ...a('L0W0', 0), name: 'apple' },
      { ...a('L0W1', 1), name: 'and' }
    ]
    expect(插入后顺序(existing, 'L3W5', 'later')).toEqual(['apple', 'and', 'later'])
  })

  it('正文里最靠前的，排到最前面', () => {
    const existing = [
      { ...a('L1W0', 0), name: 'and' },
      { ...a('L2W0', 1), name: 'ear' }
    ]
    expect(插入后顺序(existing, 'L0W0', 'apple')).toEqual(['apple', 'and', 'ear'])
  })

  it('第一条标注从 0 开始', () => {
    expect(insertionOrder([], 'L0W0')).toBe(0)
  })

  it('跨行也按正文顺序', () => {
    const existing = [
      { ...a('L0W5', 0), name: '第一行的词' },
      { ...a('L2W1', 1), name: '第三行的词' }
    ]
    expect(插入后顺序(existing, 'L1W0', '第二行的词')).toEqual([
      '第一行的词',
      '第二行的词',
      '第三行的词'
    ])
  })
})

describe('不冲掉用户拖出来的顺序', () => {
  it('别人已经被拖乱了，新的只挨着「正文里它前面那条」，其余次序不动', () => {
    // 用户把 ear 拖到了 apple 前面
    const existing = [
      { ...a('L0W2', 0), name: 'ear' },
      { ...a('L0W0', 1), name: 'apple' }
    ]
    // 新标的 and 在正文里紧跟 apple，所以排在 apple 后面
    expect(插入后顺序(existing, 'L0W1', 'and')).toEqual(['ear', 'apple', 'and'])
  })

  it('算出来的是小数也没关系，排序只看大小', () => {
    const existing = [a('L0W0', 0), a('L0W2', 1)]
    const order = insertionOrder(existing, 'L0W1')
    expect(order).toBeGreaterThan(0)
    expect(order).toBeLessThan(1)
  })

  it('连插几条都能各就各位', () => {
    let list = [
      { ...a('L0W0', 0), name: 'a' },
      { ...a('L0W9', 1), name: 'z' }
    ]
    for (const [anchor, name] of [['L0W5', 'm'], ['L0W2', 'c'], ['L0W7', 'x']] as const) {
      list = [...list, { start: anchor, order: insertionOrder(list, anchor), name }]
    }
    expect(list.sort((p, q) => p.order - q.order).map((x) => x.name)).toEqual([
      'a',
      'c',
      'm',
      'x',
      'z'
    ])
  })
})

describe('孤儿标注（原文已删除，没有位置）', () => {
  it('列表里全是孤儿时，新的接在最后', () => {
    const existing = [a(null, 0), a(null, 1)]
    expect(insertionOrder(existing, 'L0W0')).toBe(2)
  })

  it('孤儿不参与比较，但也不会被挤掉', () => {
    const existing = [
      { ...a('L0W0', 0), name: 'apple' },
      { ...a(null, 1), name: '孤儿' },
      { ...a('L0W2', 2), name: 'ear' }
    ]
    // and 在正文里紧跟 apple，插在 apple 与孤儿之间；孤儿与 ear 的相对次序不变
    expect(插入后顺序(existing, 'L0W1', 'and')).toEqual(['apple', 'and', '孤儿', 'ear'])
  })
})
