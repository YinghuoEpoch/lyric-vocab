import { describe, expect, it } from 'vitest'
import { isLeftSidebarVisible } from './useWideLayout'

/*
  钉的是「左栏此刻看不看得见」这一个答案。

  为什么值得单独钉：这个 app 里「收起左栏」有**两套互不相干的机制**，
  宽屏改 wideLeftHidden、窄屏改 activePanel。2026-09-07 之前
  LeftSidebar 只拿到窄屏那一套，于是「收起就退出整理模式」
  在平板横屏上从来没生效过 —— 而窄屏一切正常，所以两周没人发现。

  下面每一条都对应一种「另一套机制在动」的情形。
*/
describe('isLeftSidebarVisible', () => {
  describe('宽屏（平板横屏）：只看 wideLeftHidden', () => {
    it('没收起 -> 看得见', () => {
      expect(
        isLeftSidebarVisible({ isWide: true, wideLeftHidden: false, narrowPanelOpen: false })
      ).toBe(true)
    })

    it('收起了 -> 看不见', () => {
      expect(
        isLeftSidebarVisible({ isWide: true, wideLeftHidden: true, narrowPanelOpen: false })
      ).toBe(false)
    })

    /*
      这一条是那个 bug 的正身。

      宽屏上 activePanel 恒为 null，所以 narrowPanelOpen 一直是 false；
      从前直接把它当成「左栏开着没有」，于是宽屏上永远读到「没开着」，
      「开着 -> 关上」那个跳变一次都不会发生。
    */
    it('⚠️ 宽屏上 narrowPanelOpen 恒 false，但左栏其实看得见', () => {
      expect(
        isLeftSidebarVisible({ isWide: true, wideLeftHidden: false, narrowPanelOpen: false })
      ).toBe(true)
    })

    it('宽屏不看 narrowPanelOpen —— 它是 true 也照样以 wideLeftHidden 为准', () => {
      expect(
        isLeftSidebarVisible({ isWide: true, wideLeftHidden: true, narrowPanelOpen: true })
      ).toBe(false)
    })
  })

  describe('窄屏（手机、平板竖屏）：只看浮层开着没有', () => {
    it('浮层呼出着 -> 看得见', () => {
      expect(
        isLeftSidebarVisible({ isWide: false, wideLeftHidden: false, narrowPanelOpen: true })
      ).toBe(true)
    })

    it('浮层收着 -> 看不见', () => {
      expect(
        isLeftSidebarVisible({ isWide: false, wideLeftHidden: false, narrowPanelOpen: false })
      ).toBe(false)
    })

    /*
      窄屏上 wideLeftHidden 是个没人维护的残值 —— 从宽屏转过来时它可能停在
      任何一个值上。窄屏必须无视它，否则转屏之后左栏会凭空消失或凭空出现。
    */
    it('窄屏不看 wideLeftHidden —— 它是 true 也照样以浮层为准', () => {
      expect(
        isLeftSidebarVisible({ isWide: false, wideLeftHidden: true, narrowPanelOpen: true })
      ).toBe(true)
    })
  })

  describe('转屏：跨过 1024 那条线时不能算错', () => {
    /*
      平板从竖屏转横屏（800 -> 1280）。竖屏时左栏是收着的浮层，
      转过去之后宽屏那一套接管，wideLeftHidden 默认 false，左栏该露出来。
    */
    it('竖屏收着 -> 转横屏，左栏露出来', () => {
      const before = { isWide: false, wideLeftHidden: false, narrowPanelOpen: false }
      const after = { ...before, isWide: true }
      expect(isLeftSidebarVisible(before)).toBe(false)
      expect(isLeftSidebarVisible(after)).toBe(true)
    })

    /*
      反过来：横屏左栏开着，转回竖屏。窄屏看的是浮层，而浮层是收着的，
      所以左栏收起来 —— 这一跳变会让整理模式自动退出，是对的。
    */
    it('横屏开着 -> 转竖屏，左栏收起来', () => {
      const before = { isWide: true, wideLeftHidden: false, narrowPanelOpen: false }
      const after = { ...before, isWide: false }
      expect(isLeftSidebarVisible(before)).toBe(true)
      expect(isLeftSidebarVisible(after)).toBe(false)
    })
  })
})
