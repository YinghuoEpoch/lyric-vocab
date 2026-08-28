import { describe, it, expect } from 'vitest'
import { pushBackHandler, handleBackPress, BackPriority } from './useBackHandler'

/**
 * 安卓返回键调度的回归测试。
 *
 * 安卓返回键在浏览器里不存在，没法端到端测，所以这里覆盖调度逻辑本身：
 * 一次只关一层、按优先级关、关掉的层要能正确注销。
 */

describe('返回键调度', () => {
  it('没有任何登记项时返回 false（调用方据此退出 App）', () => {
    expect(handleBackPress()).toBe(false)
  })

  it('一次只执行一层，不会把所有层一起关掉', () => {
    const calls: string[] = []
    const offA = pushBackHandler(BackPriority.panel, () => calls.push('侧栏'))
    const offB = pushBackHandler(BackPriority.recycleBin, () => calls.push('回收站'))

    expect(handleBackPress()).toBe(true)
    expect(calls).toEqual(['回收站'])

    offA()
    offB()
  })

  it('按优先级关，与登记先后无关', () => {
    const calls: string[] = []
    // 故意先登记高优先级的，再登记低优先级的
    const offTop = pushBackHandler(BackPriority.confirmDelete, () => calls.push('确认框'))
    const offLow = pushBackHandler(BackPriority.panel, () => calls.push('侧栏'))

    handleBackPress()
    expect(calls).toEqual(['确认框'])

    offTop()
    offLow()
  })

  it('逐层关闭：确认框 -> 回收站 -> 侧栏', () => {
    const calls: string[] = []
    const offs = [
      pushBackHandler(BackPriority.panel, () => {
        calls.push('侧栏')
        offs[0]()
      }),
      pushBackHandler(BackPriority.recycleBin, () => {
        calls.push('回收站')
        offs[1]()
      }),
      pushBackHandler(BackPriority.confirmDelete, () => {
        calls.push('确认框')
        offs[2]()
      })
    ]

    handleBackPress()
    handleBackPress()
    handleBackPress()

    expect(calls).toEqual(['确认框', '回收站', '侧栏'])
    // 三层都关完之后，再按返回就该退出 App 了
    expect(handleBackPress()).toBe(false)
  })

  it('同优先级时后登记的先关（更晚打开的更靠上）', () => {
    const calls: string[] = []
    const off1 = pushBackHandler(BackPriority.panel, () => calls.push('先开的'))
    const off2 = pushBackHandler(BackPriority.panel, () => calls.push('后开的'))

    handleBackPress()
    expect(calls).toEqual(['后开的'])

    off1()
    off2()
  })

  it('注销后不再被触发', () => {
    const calls: string[] = []
    const off = pushBackHandler(BackPriority.recycleBin, () => calls.push('回收站'))
    off()

    expect(handleBackPress()).toBe(false)
    expect(calls).toEqual([])
  })

  it('优先级常量的相对顺序符合界面的层叠关系', () => {
    expect(BackPriority.orphanPrompt).toBeGreaterThan(BackPriority.confirmDelete)
    expect(BackPriority.confirmDelete).toBeGreaterThan(BackPriority.recycleBin)
    expect(BackPriority.recycleBin).toBeGreaterThan(BackPriority.wordDrawer)
    expect(BackPriority.wordDrawer).toBeGreaterThan(BackPriority.panel)
    expect(BackPriority.panel).toBeGreaterThan(BackPriority.editMode)
  })
})
