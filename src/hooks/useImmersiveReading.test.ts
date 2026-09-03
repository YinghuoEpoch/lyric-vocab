import { describe, it, expect } from 'vitest'
import { shouldImmerse, type ImmersiveConditions } from './useImmersiveReading'

/**
 * 「什么时候进沉浸」的回归测试。
 *
 * 沉浸的真身在真机上：系统栏藏没藏、从顶端下滑灵不灵，那些我验不了。
 * 但**进不进**这一层是纯判断，可以钉死 —— 尤其是「窄屏一律不进」那条：
 * 手机上两侧栏本来就总是收着的，这条一旦漏了，手机会一直待在沉浸里。
 */

/** 平板横屏、两侧栏都收起来、正在读书 —— 该进沉浸的那一套 */
const 沉浸态: ImmersiveConditions = {
  isWide: true,
  mode: 'read',
  editMode: false,
  leftHidden: true,
  rightOpen: false
}

describe('该不该进沉浸', () => {
  it('平板横屏、两侧栏都收起来、正在读书：进', () => {
    expect(shouldImmerse(沉浸态)).toBe(true)
  })

  it('窄屏一律不进 —— 手机上两侧栏本来就总是收着的', () => {
    expect(shouldImmerse({ ...沉浸态, isWide: false })).toBe(false)
  })

  it('左栏放出来了就不进', () => {
    expect(shouldImmerse({ ...沉浸态, leftHidden: false })).toBe(false)
  })

  it('笔记栏开着就不进', () => {
    expect(shouldImmerse({ ...沉浸态, rightOpen: true })).toBe(false)
  })

  it('复习模式不进 —— 那边要用编辑键', () => {
    expect(shouldImmerse({ ...沉浸态, mode: 'review' })).toBe(false)
  })

  it('编辑全文时不进 —— 那边要用工具栏', () => {
    expect(shouldImmerse({ ...沉浸态, editMode: true })).toBe(false)
  })
})
