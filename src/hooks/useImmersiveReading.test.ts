import { describe, it, expect } from 'vitest'
import { shouldImmerse, type ImmersiveConditions } from './useImmersiveReading'

/**
 * 「什么时候进沉浸」的回归测试。
 *
 * 沉浸的真身在真机上：系统栏藏没藏、从顶端下滑灵不灵，那些我验不了。
 * 但**进不进**这一层是纯判断，可以钉死。
 *
 * 最要紧的是**宽窄两套触发方式别串了**：
 *
 * - 宽屏看的是「两侧栏收起来没有」，手指不参与
 * - 窄屏只认手指那个开关。窄屏上侧栏本来就总是收着的，
 *   要是也照宽屏那条规矩办，手机会一直待在沉浸里
 */

/** 平板横屏、两侧栏都收起来、正在读书 —— 宽屏该进沉浸的那一套 */
const 宽屏沉浸: ImmersiveConditions = {
  isWide: true,
  mode: 'read',
  editMode: false,
  leftHidden: true,
  panelOpen: false,
  narrowOn: false
}

/** 手机（或平板竖屏）上刚点过一下空白处 */
const 窄屏沉浸: ImmersiveConditions = {
  isWide: false,
  mode: 'read',
  editMode: false,
  leftHidden: false,
  panelOpen: false,
  narrowOn: true
}

describe('该不该进沉浸·宽屏', () => {
  it('两侧栏都收起来、正在读书：进', () => {
    expect(shouldImmerse(宽屏沉浸)).toBe(true)
  })

  it('左栏放出来了就不进', () => {
    expect(shouldImmerse({ ...宽屏沉浸, leftHidden: false })).toBe(false)
  })

  it('笔记栏开着就不进', () => {
    expect(shouldImmerse({ ...宽屏沉浸, panelOpen: true })).toBe(false)
  })

  it('不看手指那个开关 —— 宽屏是自动的', () => {
    expect(shouldImmerse({ ...宽屏沉浸, narrowOn: false })).toBe(true)
    expect(shouldImmerse({ ...宽屏沉浸, leftHidden: false, narrowOn: true })).toBe(false)
  })
})

describe('该不该进沉浸·窄屏', () => {
  it('点过一下空白处：进', () => {
    expect(shouldImmerse(窄屏沉浸)).toBe(true)
  })

  it('**没点过就不进** —— 窄屏侧栏本来就总是收着的，不能拿它当信号', () => {
    expect(shouldImmerse({ ...窄屏沉浸, narrowOn: false })).toBe(false)
  })

  it('侧栏浮层开着就不进', () => {
    expect(shouldImmerse({ ...窄屏沉浸, panelOpen: true })).toBe(false)
  })
})

describe('两种宽度都否决的情形', () => {
  for (const [名字, 底子] of [
    ['宽屏', 宽屏沉浸],
    ['窄屏', 窄屏沉浸]
  ] as const) {
    it(`${名字}：复习模式不进 —— 那边要用编辑键`, () => {
      expect(shouldImmerse({ ...底子, mode: 'review' })).toBe(false)
    })

    it(`${名字}：编辑全文时不进 —— 那边要用工具栏`, () => {
      expect(shouldImmerse({ ...底子, editMode: true })).toBe(false)
    })
  }
})
