import { describe, it, expect } from 'vitest'
import { isHorizontalSwipe, shouldStayOpen, clampOffset, REVEAL_PX } from './SwipeToDelete'

/**
 * 左滑删除的判断逻辑。
 *
 * 真手感得在手机上试，这里守的是两条一旦写错就很难用的规矩：
 * **手指想滚页面时别去抢**（抢了列表就划不动），
 * 以及**松手停在哪**（判错了就是滑一下弹回去、看着像没反应）。
 */

describe('这一下算不算横滑', () => {
  it('横向够大、又比纵向大，才算', () => {
    expect(isHorizontalSwipe(-30, 4)).toBe(true)
  })

  it('手指在竖着滚，绝不能抢 —— 抢了整个列表就划不动了', () => {
    expect(isHorizontalSwipe(-10, 40)).toBe(false)
    expect(isHorizontalSwipe(3, 60)).toBe(false)
  })

  it('只是手抖那么一点，不算', () => {
    expect(isHorizontalSwipe(-5, 2)).toBe(false)
  })

  it('斜着划、横向占优才算', () => {
    expect(isHorizontalSwipe(-30, 20)).toBe(true)
    expect(isHorizontalSwipe(-20, 30)).toBe(false)
  })
})

describe('松手之后停在哪', () => {
  it('拉过一半就开着', () => {
    expect(shouldStayOpen(-(REVEAL_PX / 2 + 1))).toBe(true)
  })

  it('没拉到一半就弹回去', () => {
    expect(shouldStayOpen(-(REVEAL_PX / 2 - 1))).toBe(false)
    expect(shouldStayOpen(0)).toBe(false)
  })
})

describe('位移夹在范围内', () => {
  it('往右拉不出头', () => {
    expect(clampOffset(50)).toBe(0)
  })

  it('往左最多露出删除区那么宽', () => {
    expect(clampOffset(-500)).toBe(-REVEAL_PX)
  })

  it('中间的原样', () => {
    expect(clampOffset(-30)).toBe(-30)
  })
})
