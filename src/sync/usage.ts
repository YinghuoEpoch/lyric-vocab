/**
 * 流量记账。
 *
 * ## 为什么要有
 *
 * 用户问过两次「会不会用完额度」，我估了两次，**两次都错**：
 * 一次乐观十倍（拿别的数据集的数当他的），一次悲观五倍
 * （按「一天同步 180 次」估，可实际上只有真有改动才上传）。
 *
 * 估算这条路已经证明走不通了。**改成记真账** —— 每次同步本来就算出了
 * 上下行字节，从前用完就扔，现在累加起来。读数屏直接显示「本月已用多少」，
 * 这个问题从此有确定答案，不用猜。
 *
 * ## 为什么按自然月
 *
 * 坚果云的免费额度就是按自然月给的（每月 1 G 上传、3 G 下载），
 * 跟着它走，数字才能直接对上。**换月自动归零**，不留历史 ——
 * 要看的是「这个月还剩多少」，不是流水账。
 */

const KEY = 'lyric-vocab-sync-usage'

/** 坚果云免费账户的月额度（字节） */
export const QUOTA_UP = 1024 * 1024 * 1024
export const QUOTA_DOWN = 3 * 1024 * 1024 * 1024

export interface SyncUsage {
  /** 哪个月的账，形如 `2026-09` */
  month: string
  up: number
  down: number
  /** 真正走了流量的同步次数（「没走流量」那种不算） */
  syncs: number
}

/** `2026-09`。用本地时区 —— 用户看的是自己的日历 */
export function monthKey(now = Date.now()): string {
  const d = new Date(now)
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`
}

function empty(month: string): SyncUsage {
  return { month, up: 0, down: 0, syncs: 0 }
}

/**
 * 读这个月的账。**换月了就当零** —— 上个月的数字对「还剩多少」没有意义。
 *
 * 读不出来（隐私模式、存储被清）一律返回零，不抛错：
 * 记账失败不该影响同步本身。
 */
export function loadUsage(now = Date.now()): SyncUsage {
  const month = monthKey(now)
  try {
    const raw = localStorage.getItem(KEY)
    if (!raw) return empty(month)
    const p = JSON.parse(raw) as Partial<SyncUsage>
    if (p.month !== month) return empty(month)
    return {
      month,
      up: typeof p.up === 'number' && p.up >= 0 ? p.up : 0,
      down: typeof p.down === 'number' && p.down >= 0 ? p.down : 0,
      syncs: typeof p.syncs === 'number' && p.syncs >= 0 ? p.syncs : 0
    }
  } catch {
    return empty(month)
  }
}

/**
 * 记一笔。上下行都是 0 就不记（那是「没走流量」那种，不该算进次数里）。
 *
 * 写失败一样吞掉 —— 见 loadUsage。
 */
export function addUsage(up: number, down: number, now = Date.now()): SyncUsage {
  const cur = loadUsage(now)
  if (up <= 0 && down <= 0) return cur
  const next: SyncUsage = {
    month: cur.month,
    up: cur.up + Math.max(0, up),
    down: cur.down + Math.max(0, down),
    syncs: cur.syncs + 1
  }
  try {
    localStorage.setItem(KEY, JSON.stringify(next))
  } catch {
    // 记不上就算了，不能因为记账失败把同步搞挂
  }
  return next
}

/** 占了额度的百分之几（上不封顶，超了就该看见超了） */
export function usagePercent(used: number, quota: number): number {
  return Math.round((used / quota) * 100)
}
