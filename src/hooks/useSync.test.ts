import { describe, it, expect } from 'vitest'
import { decideAutoSync } from './useSync'

/**
 * 「这一次到底同不同步」的回归测试。
 *
 * 同步的真身在网络那头（坚果云的脾气、三方合并），那些这里验不了。
 * 但**走不走、被拦了之后补不补**是纯判断，可以钉死 ——
 * 而且这一块在真机上极难验：要盯着秒表，还得两台设备一起看。
 *
 * 要钉住的就一句话：**自动的一旦被拦，一律改约，绝不就地放弃。**
 * 放弃的后果是「我明明改了，另一台没更新」，2026-09-04 用户报的正是这个。
 */

const 一分钟 = 60 * 1000

/** 默认场景：自动触发、没有别的轮次在跑、离上次自动同步已经很久 */
const 基准 = { silent: true, running: false, now: 10_000_000, lastAutoAt: 0 }

describe('手动那颗按钮', () => {
  it('不受最小间隔限制 —— 人明确要同步时不该被拦', () => {
    const 刚同步完 = { ...基准, silent: false, lastAutoAt: 基准.now - 1000 }
    expect(decideAutoSync(刚同步完)).toEqual({ kind: 'go' })
  })

  it('已经有一轮在跑：跳过，也不改约（按钮此刻本来就是禁用的）', () => {
    expect(decideAutoSync({ ...基准, silent: false, running: true })).toEqual({ kind: 'skip' })
  })
})

describe('自动同步的两道闸', () => {
  it('离上次够久了：走', () => {
    expect(decideAutoSync(基准)).toEqual({ kind: 'go' })
  })

  it('正好卡在一分钟整：走（闸是「至少隔这么久」，到点就算数）', () => {
    expect(decideAutoSync({ ...基准, lastAutoAt: 基准.now - 一分钟 })).toEqual({ kind: 'go' })
  })

  it('⚠️ 离上次才 18 秒：不是丢掉，而是约到闸开的那一刻（还差 42 秒）', () => {
    const 刚同步完18秒 = { ...基准, lastAutoAt: 基准.now - 18_000 }
    expect(decideAutoSync(刚同步完18秒)).toEqual({ kind: 'retry', afterMs: 42_000 })
  })

  it('⚠️ 已经有一轮在跑：也改约，不丢 —— 跑着的那轮带不上这次改动', () => {
    const g = decideAutoSync({ ...基准, running: true })
    expect(g.kind).toBe('retry')
    expect(g.kind === 'retry' && g.afterMs > 0).toBe(true)
  })

  it('「在跑」优先于「间隔」判断 —— 两个都撞上时，先等那轮跑完', () => {
    const 两个都撞上 = { ...基准, running: true, lastAutoAt: 基准.now - 1000 }
    const g = decideAutoSync({ ...两个都撞上, runningRetryMs: 2000 })
    expect(g).toEqual({ kind: 'retry', afterMs: 2000 })
  })

  it('补的那一次到点了就真的会走 —— 不会一直改约下去（免得空转）', () => {
    const 被拦 = decideAutoSync({ ...基准, lastAutoAt: 基准.now - 18_000 })
    expect(被拦.kind).toBe('retry')
    // 按它说的等到那一刻再问一次
    const 到点 = decideAutoSync({
      ...基准,
      lastAutoAt: 基准.now - 18_000,
      now: 基准.now + (被拦.kind === 'retry' ? 被拦.afterMs : 0)
    })
    expect(到点).toEqual({ kind: 'go' })
  })

  it('从没同步过（lastAutoAt 为 0）：直接走，别让开 app 第一次也等一分钟', () => {
    // ⚠️ now 要用真实时间戳。第一版这里写了 now: 1000，算出「还差 59 秒」判成改约 ——
    // 那是**测试自己写错**：现实里 Date.now() 是万亿级，减 0 永远远大于一分钟。
    expect(decideAutoSync({ ...基准, lastAutoAt: 0, now: Date.now() })).toEqual({ kind: 'go' })
  })
})
