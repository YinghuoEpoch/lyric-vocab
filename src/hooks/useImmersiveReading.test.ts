import { describe, it, expect } from 'vitest'
import { chromeVisibleOnImmersiveChange, shouldImmerse, type ImmersiveConditions } from './useImmersiveReading'

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

describe('进 / 出沉浸时，顶栏那一套该在什么位置', () => {
  /*
    用户 2026-09-07 报的那件：平板上笔记栏开着时点空白处，
    收笔记栏和收顶栏一起发生，「两个效果分别发生就很粗糙」。

    那两件不是同一下触发的 —— 收完笔记栏两侧栏就都收起来了，
    沉浸当场成立，而从前一进沉浸就把顶栏打回「收着」。
    现在宽屏进沉浸时顶栏先留着、3 秒的表照常走，
    于是「收笔记栏」和「收顶栏」变成先后两次点击。
  */
  it('宽屏刚进沉浸：顶栏留着（等于替他点了一下叫出来），随后由 3 秒的表收掉', () => {
    expect(chromeVisibleOnImmersiveChange(true, true)).toBe(true)
  })

  /*
    ⚠️ 窄屏这一条不能跟着改。手机上进沉浸就是用户亲手点的那一下，
    意思是「我要清屏」，留着 3 秒等于没听见他。
  */
  it('⚠️ 窄屏刚进沉浸：立刻收 —— 那一下是用户亲手要的清屏', () => {
    expect(chromeVisibleOnImmersiveChange(true, false)).toBe(false)
  })

  it('出沉浸：一律回到 false，两种宽度都一样', () => {
    expect(chromeVisibleOnImmersiveChange(false, true)).toBe(false)
    expect(chromeVisibleOnImmersiveChange(false, false)).toBe(false)
  })

  /*
    出沉浸时这个值其实不参与显示（那时候顶栏由正常布局管），
    但必须归零 —— 不归零的话下一次进沉浸会带着上一次的残值，
    宽窄之间转屏时尤其容易串。
  */
  it('出沉浸时归零，下一次进沉浸不带残值', () => {
    expect(chromeVisibleOnImmersiveChange(false, true)).toBe(false)
  })
})
