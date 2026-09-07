import { describe, expect, it } from 'vitest'
import { clampDragY } from './LeftSidebar'

/**
 * 整理模式里拖动那一行的上下边界。
 *
 * 钉的是「夹到哪儿」这一件事。真实的拖拽手感我在这台电脑上验不了，
 * 但「能不能够到第一行上面」「会不会盖住底栏」是算得清的。
 *
 * 下面这些数不是编的，是 2026-09-07 在浏览器里量出来的（1280×800，5 个文库）：
 * 列表区 top=96 bottom=744，被拖那行 top=328 height=42。
 */
describe('clampDragY', () => {
  // 量出来的真实布局
  const area = { top: 96, bottom: 744 }
  const dragging = { top: 328, bottom: 370 }

  describe('上边界：必须够得到列表最顶上', () => {
    it('一路往上拖，停在列表顶部而不是更上面', () => {
      expect(clampDragY(-9999, dragging, area)).toBe(96 - 328)
    })

    /*
      这一条是「文库拖不到最顶部」那个 bug 的正身。

      从前写死 160：被拖那行的顶最低只能到 160，而第一行中线在 117，
      于是永远越不过去，只能停在第 2 位。现在夹到 96，也就是列表真正的顶，
      第一行的中线就在够得到的范围里了。
    */
    it('⚠️ 够得到第一行的中线（从前写死 160 时够不到）', () => {
      const y = clampDragY(-9999, dragging, area)
      const 拖动后那行的顶 = dragging.top + y
      expect(拖动后那行的顶).toBe(96)
      // 第一行 top=107 height≈21 -> 中线约 117，必须能压过去
      expect(拖动后那行的顶).toBeLessThan(117)
    })

    it('往上拖得不多时，原样放行', () => {
      expect(clampDragY(-50, dragging, area)).toBe(-50)
    })
  })

  describe('下边界：不能盖住底栏', () => {
    /*
      「拖动的动画可以被拖到底栏上」那个 bug 的正身。
      从前只有 Math.max（夹上边），下边完全敞开。
    */
    it('⚠️ 一路往下拖，底不越过列表底部（底栏在 744 以下）', () => {
      const y = clampDragY(9999, dragging, area)
      expect(dragging.bottom + y).toBe(744)
    })

    it('往下拖得不多时，原样放行', () => {
      expect(clampDragY(80, dragging, area)).toBe(80)
    })
  })

  describe('边角情况', () => {
    it('列表比被拖那行还矮时，贴着顶部，不反弹到下面去', () => {
      const 矮列表 = { top: 100, bottom: 120 }
      const 高行 = { top: 300, bottom: 380 }
      expect(clampDragY(9999, 高行, 矮列表)).toBe(100 - 300)
    })

    it('量不到矩形时原样返回，不瞎夹', () => {
      expect(clampDragY(123, null, area)).toBe(123)
      expect(clampDragY(123, dragging, null)).toBe(123)
    })

    /*
      同一次拖动，换一台状态栏更高的机器 —— 整块区域和行一起往下挪。
      结论必须跟着挪，这正是写死的数做不到的事。
      （用户的手机状态栏 ~48px，所以那个写死的 160 在他手机上恰好不碍事）
    */
    it('整块布局下移 48px（状态栏更高的机器），边界跟着走', () => {
      const 下移 = 48
      const a = { top: area.top + 下移, bottom: area.bottom + 下移 }
      const d = { top: dragging.top + 下移, bottom: dragging.bottom + 下移 }
      expect(clampDragY(-9999, d, a)).toBe(a.top - d.top)
      expect(d.top + clampDragY(-9999, d, a)).toBe(a.top)
    })
  })
})
