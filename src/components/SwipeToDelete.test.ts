import { describe, it, expect } from 'vitest'
import {
  isHorizontalSwipe,
  shouldAskDelete,
  pullOffset,
  TRIGGER_PX,
  MAX_PULL_PX
} from './SwipeToDelete'

/**
 * 左滑删除的判断逻辑。
 *
 * 真手感得在手机上试，这里守的是两条一旦写错就很难用的规矩：
 * **手指想滚页面时别去抢**（抢了列表就划不动），
 * 以及**划到什么程度才算数**（判松了会误删，判紧了像没反应）。
 *
 * 这一批断言在「不再露红按钮、划到位直接弹确认框」那一版改过：
 * 从前问的是「松手停在哪」，现在问的是「够不够格问那一句」。
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

describe('划到什么程度才问「确定要删吗」', () => {
  it('划过触发线就问', () => {
    expect(shouldAskDelete(-TRIGGER_PX)).toBe(true)
    expect(shouldAskDelete(-(TRIGGER_PX + 10))).toBe(true)
  })

  it('差一点点也不问 —— 误删的代价是笔记再也找不回来', () => {
    expect(shouldAskDelete(-(TRIGGER_PX - 1))).toBe(false)
    expect(shouldAskDelete(0)).toBe(false)
  })
})

describe('手指走多远，卡片挪多少', () => {
  it('往右拉不出头，卡片本来就在原位', () => {
    expect(pullOffset(50)).toBe(0)
    expect(pullOffset(0)).toBe(0)
  })

  it('触发线之前是一比一跟着走', () => {
    expect(pullOffset(-30)).toBe(-30)
    expect(pullOffset(-TRIGGER_PX)).toBe(-TRIGGER_PX)
  })

  it('过了触发线越拉越沉 —— 这是唯一的「已经划够了」的提示', () => {
    // 多划 30px，卡片只多走 10px
    expect(pullOffset(-(TRIGGER_PX + 30))).toBeCloseTo(-(TRIGGER_PX + 10), 5)
  })

  it('再用力也有个头，不会把卡片拉出屏幕', () => {
    expect(pullOffset(-2000)).toBe(-MAX_PULL_PX)
  })
})
