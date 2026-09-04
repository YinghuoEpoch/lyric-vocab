import { describe, it, expect, beforeEach } from 'vitest'
import { addUsage, loadUsage, monthKey, usagePercent, QUOTA_UP } from './usage'

/**
 * 流量记账的回归测试。
 *
 * 这东西存在的唯一理由是**别再估**（我估错过两次）。所以要钉住的是：
 * 加得对、换月归零、「没走流量」不计数、存储坏了不许把同步搞挂。
 */

const KEY = 'lyric-vocab-sync-usage'
const 九月 = new Date('2026-09-15T10:00:00').getTime()
const 十月 = new Date('2026-10-02T10:00:00').getTime()

/*
 * 测试跑在 node 环境里，没有 localStorage（项目里没装 jsdom，
 * 不值得为这一个模块加一整个依赖）。塞一个最小的假货，行为照真的来。
 */
const 假存储 = new Map<string, string>()
;(globalThis as unknown as { localStorage: Storage }).localStorage = {
  getItem: (k: string) => 假存储.get(k) ?? null,
  setItem: (k: string, v: string) => void 假存储.set(k, String(v)),
  removeItem: (k: string) => void 假存储.delete(k),
  clear: () => 假存储.clear(),
  key: (i: number) => [...假存储.keys()][i] ?? null,
  get length() {
    return 假存储.size
  }
} as Storage

beforeEach(() => localStorage.clear())

describe('月份', () => {
  it('形如 2026-09，个位数月份补零', () => {
    expect(monthKey(new Date('2026-09-15T10:00:00').getTime())).toBe('2026-09')
    expect(monthKey(new Date('2026-12-31T23:00:00').getTime())).toBe('2026-12')
  })
})

describe('记账', () => {
  it('一笔笔加起来', () => {
    addUsage(1000, 2000, 九月)
    addUsage(500, 300, 九月)
    const u = loadUsage(九月)
    expect(u.up).toBe(1500)
    expect(u.down).toBe(2300)
    expect(u.syncs).toBe(2)
  })

  it('⚠️「没走流量」那种不记 —— 上下行都是 0 不该算一次同步', () => {
    addUsage(1000, 2000, 九月)
    addUsage(0, 0, 九月)
    expect(loadUsage(九月).syncs).toBe(1)
  })

  it('⚠️ 换月自动归零 —— 要看的是这个月还剩多少，不是流水账', () => {
    addUsage(9999, 9999, 九月)
    const 十月的账 = loadUsage(十月)
    expect(十月的账).toEqual({ month: '2026-10', up: 0, down: 0, syncs: 0 })
  })

  it('换月之后再记，是从零开始加的', () => {
    addUsage(9999, 9999, 九月)
    addUsage(100, 200, 十月)
    expect(loadUsage(十月)).toEqual({ month: '2026-10', up: 100, down: 200, syncs: 1 })
  })

  it('还没记过任何账时是零，不是报错', () => {
    expect(loadUsage(九月)).toEqual({ month: '2026-09', up: 0, down: 0, syncs: 0 })
  })
})

describe('存储坏了也不能把同步搞挂', () => {
  it('存的是一堆乱码：当零处理', () => {
    localStorage.setItem(KEY, '这不是 JSON')
    expect(loadUsage(九月).up).toBe(0)
  })

  it('存的数是负的或者根本不是数：当零处理', () => {
    localStorage.setItem(KEY, JSON.stringify({ month: '2026-09', up: -5, down: 'x', syncs: null }))
    const u = loadUsage(九月)
    expect(u.up).toBe(0)
    expect(u.down).toBe(0)
    expect(u.syncs).toBe(0)
  })

  it('负数传进来也不会把账做小', () => {
    addUsage(1000, 1000, 九月)
    addUsage(-500, 100, 九月)
    expect(loadUsage(九月).up).toBe(1000)
  })
})

describe('百分比', () => {
  it('照额度算', () => {
    expect(usagePercent(QUOTA_UP / 2, QUOTA_UP)).toBe(50)
    expect(usagePercent(0, QUOTA_UP)).toBe(0)
  })

  it('超了要看得见超了，不封在 100', () => {
    expect(usagePercent(QUOTA_UP * 1.5, QUOTA_UP)).toBe(150)
  })
})
