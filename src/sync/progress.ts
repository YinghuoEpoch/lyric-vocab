import type { AppData } from '../types'

/**
 * 阅读进度单独走一条路。
 *
 * ## 为什么要拆出来
 *
 * 进度是**流量的头号大户**：你一路往下读，滚动位置一直在存，
 * 每一次都算「数据变了」，而从前那意味着把整份 `data.json` 重传一遍。
 *
 * 从前的治法是「只有进度变了就先别传」（`onlyProgressChanged`）——
 * 省下了流量，代价是**进度不实时**：手机上读到第 50 页，切到平板还是旧位置，
 * 得等你划个词才顺路带过去。
 *
 * 现在拆成一个几百字节的小文件 `progress.json`：进度从索引里摘出去，
 * 索引因此在读书时**纹丝不动**；进度自己随时可以传，因为它足够小。
 * 两个问题一起解决 —— 既不重传整份，又能实时。
 *
 * ## 合并规则：**谁记得晚谁赢**（按每一篇分别算）
 *
 * 两台设备读同一篇时，位置只能有一个。没有更聪明的办法 ——
 * 「读得更远的赢」听着合理，其实是错的：你在平板上翻回前面重读，
 * 那才是你最新的意图，不该被手机上的旧记录顶回去。
 *
 * 没有 `progressAt` 的老数据当 0 —— 谁记了时间谁赢；都没记就保持本地不动
 * （别拿一个不知道什么时候的位置去覆盖用户眼前正在读的那一页）。
 */

/** 一篇文档的进度：位置 + 什么时候记的 */
export interface ProgressEntry {
  v: number
  at: number
}

/** 文档 id -> 进度 */
export type ProgressMap = Record<string, ProgressEntry>

/** 从数据里抽出进度表。没读过的（没有 progress）不收，省得白占地方 */
export function progressOf(data: AppData): ProgressMap {
  const out: ProgressMap = {}
  for (const p of data.pages ?? []) {
    if (typeof p.progress !== 'number' || p.progress <= 0) continue
    out[p.id] = { v: p.progress, at: p.progressAt ?? 0 }
  }
  return out
}

/**
 * 合并两份进度表：按篇比 `at`，晚的赢。
 *
 * 平局（含两边都没有时间戳）**保本地的** —— 用户眼前正在读的那一页优先，
 * 别被一个不知道什么时候的位置顶掉。
 */
export function mergeProgress(local: ProgressMap, remote: ProgressMap): ProgressMap {
  const out: ProgressMap = { ...local }
  for (const [id, r] of Object.entries(remote)) {
    const l = out[id]
    if (!l || r.at > l.at) out[id] = r
  }
  return out
}

/** 把进度表写回数据里。表里没有的那些篇，本地的进度原样留着 */
export function applyProgress(data: AppData, map: ProgressMap): AppData {
  return {
    ...data,
    pages: (data.pages ?? []).map((p) => {
      const e = map[p.id]
      if (!e) return p
      if (p.progress === e.v && (p.progressAt ?? 0) === e.at) return p
      return { ...p, progress: e.v, progressAt: e.at }
    })
  }
}

/** 两份进度表一不一样（用来决定要不要传） */
export function sameProgress(a: ProgressMap, b: ProgressMap): boolean {
  const ka = Object.keys(a)
  const kb = Object.keys(b)
  if (ka.length !== kb.length) return false
  return ka.every((k) => b[k] && a[k].v === b[k].v && a[k].at === b[k].at)
}
