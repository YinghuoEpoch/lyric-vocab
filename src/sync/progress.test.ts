import { describe, it, expect } from 'vitest'
import type { AppData } from '../types'
import { applyProgress, mergeProgress, progressOf, sameProgress } from './progress'

/**
 * 阅读进度单独走一条路之后的回归测试。
 *
 * 要钉住两件事：
 *
 * 1. **合并规则**：两台读同一篇时谁的位置算数（谁记得晚谁赢）
 * 2. ⚠️ **别把进度弄丢** —— 进度不在同步索引里，
 *    合并结果里天然没有它，忘了补回来就会被 replaceAllData 抹成空
 */

const page = (id: string, progress?: number, progressAt?: number) => ({
  id,
  bookId: 'b1',
  title: id,
  content: '正文',
  updatedAt: 1,
  ...(progress !== undefined ? { progress } : {}),
  ...(progressAt !== undefined ? { progressAt } : {})
})
const data = (pages: ReturnType<typeof page>[]): AppData => ({
  books: [],
  pages,
  notes: {},
  annotations: []
})

describe('抽出进度表', () => {
  it('只收读过的那些篇', () => {
    const m = progressOf(data([page('p1', 1200, 500), page('p2'), page('p3', 0)]))
    expect(Object.keys(m)).toEqual(['p1'])
    expect(m.p1).toEqual({ v: 1200, at: 500 })
  })

  it('老数据没有时间戳时当 0', () => {
    expect(progressOf(data([page('p1', 800)])).p1).toEqual({ v: 800, at: 0 })
  })
})

describe('两台设备的进度怎么合', () => {
  it('谁记得晚谁赢', () => {
    const 手机 = { p1: { v: 100, at: 1000 } }
    const 平板 = { p1: { v: 900, at: 2000 } }
    expect(mergeProgress(手机, 平板).p1.v).toBe(900)
    expect(mergeProgress(平板, 手机).p1.v).toBe(900)
  })

  it('⚠️ 不是「读得远的赢」—— 翻回前面重读才是你最新的意图', () => {
    const 早先读到很后面 = { p1: { v: 9000, at: 1000 } }
    const 刚翻回开头 = { p1: { v: 50, at: 2000 } }
    expect(mergeProgress(早先读到很后面, 刚翻回开头).p1.v).toBe(50)
  })

  it('平局保本地的 —— 别拿一个不知道什么时候的位置顶掉眼前这页', () => {
    const 本地 = { p1: { v: 100, at: 0 } }
    const 云端 = { p1: { v: 900, at: 0 } }
    expect(mergeProgress(本地, 云端).p1.v).toBe(100)
  })

  it('各读各的篇：两边的都留着', () => {
    const m = mergeProgress({ p1: { v: 1, at: 1 } }, { p2: { v: 2, at: 2 } })
    expect(Object.keys(m).sort()).toEqual(['p1', 'p2'])
  })

  it('云端有本地没读过的篇：收下来（换设备接着读，这正是要的）', () => {
    const m = mergeProgress({}, { p9: { v: 4200, at: 9 } })
    expect(m.p9.v).toBe(4200)
  })
})

describe('把进度写回数据里', () => {
  it('写回去，时间戳一并带上', () => {
    const back = applyProgress(data([page('p1')]), { p1: { v: 700, at: 42 } })
    expect(back.pages[0].progress).toBe(700)
    expect(back.pages[0].progressAt).toBe(42)
  })

  it('⚠️ 表里没提到的那些篇，本地进度原样留着（不能顺手抹了）', () => {
    const back = applyProgress(data([page('p1', 100, 5), page('p2', 200, 6)]), {
      p1: { v: 999, at: 9 }
    })
    expect(back.pages[0].progress).toBe(999)
    expect(back.pages[1].progress).toBe(200)
  })

  it('没变的那一篇原样返回同一个对象 —— 免得白白触发一轮界面重画', () => {
    const d = data([page('p1', 100, 5)])
    const back = applyProgress(d, { p1: { v: 100, at: 5 } })
    expect(back.pages[0]).toBe(d.pages[0])
  })

  it('正文和别的字段一个字都不动', () => {
    const back = applyProgress(data([page('p1', 100, 5)]), { p1: { v: 999, at: 9 } })
    expect(back.pages[0].content).toBe('正文')
    expect(back.pages[0].title).toBe('p1')
  })
})

describe('两份进度表一不一样', () => {
  it('一样就是一样', () => {
    expect(sameProgress({ p1: { v: 1, at: 2 } }, { p1: { v: 1, at: 2 } })).toBe(true)
  })

  it('位置变了、时间变了、多一篇少一篇，都算不一样', () => {
    expect(sameProgress({ p1: { v: 1, at: 2 } }, { p1: { v: 9, at: 2 } })).toBe(false)
    expect(sameProgress({ p1: { v: 1, at: 2 } }, { p1: { v: 1, at: 9 } })).toBe(false)
    expect(sameProgress({ p1: { v: 1, at: 2 } }, {})).toBe(false)
    expect(sameProgress({}, { p1: { v: 1, at: 2 } })).toBe(false)
  })
})
