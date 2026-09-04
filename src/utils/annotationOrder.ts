/**
 * 笔记的排列次序：**一律按正文顺序**，不存、不改、也不给用户拖。
 *
 * ## 从前是怎么回事
 *
 * 从前每条笔记身上存着一个 `order` 字段，复习页可以拖着排。为了「新划一条
 * 不冲掉用户拖出来的顺序」，插入位置得算「正文里紧挨着它前面那条现在排在哪」——
 * 那是一套一百行的算法，代价是列表拖乱之后，新卡片会落在一个看着莫名其妙的位置
 * （只保证挨着自己在正文里的邻居）。
 *
 * ## 现在
 *
 * 用户 2026-09-04 定的：**去掉手动排序，完全由规则排**。于是顺序变成一个
 * **算出来的东西**，不再是存下来的东西 —— 打开就是正文顺序，两台设备算出来
 * 必然一致，同步也就不可能再把顺序弄乱（第六十三节那类 bug 从根上没有了）。
 *
 * `order` 字段留在老数据里没删，但谁也不再读它、不再写它。
 */

import type { Annotation } from '../types'

/** 坐标形如 `L第几行W第几个词`；解析不出来就当它没有位置（孤儿标注） */
export function parseAnchor(anchor: string | null | undefined): [number, number] | null {
  const m = /^L(\d+)W(\d+)$/.exec(anchor ?? '')
  return m ? [Number(m[1]), Number(m[2])] : null
}

/** 比较两个坐标在正文里的先后：先看行，再看这一行里的第几个词 */
export function compareAnchors(a: string | null | undefined, b: string | null | undefined): number {
  const pa = parseAnchor(a)
  const pb = parseAnchor(b)
  if (!pa || !pb) return 0 // 有一边没位置就没法比，交给上层处理
  return pa[0] - pb[0] || pa[1] - pb[1]
}

/** 排序看得见的那几格。用最小的形状，测试和调用方都不必造一整条标注 */
export interface TextOrdered {
  start?: string | null
  end?: string | null
  createdAt?: number
  id?: string
}

/**
 * 两条笔记谁在前。规则从上往下，前一条分不出胜负才看下一条：
 *
 * 1. **有位置的排在孤儿前面**（孤儿 = 正文里那段被删了，它按定义就没有位置）
 * 2. **按起点坐标**：先看第几行，再看这一行里的第几个词
 * 3. **起点相同看终点，短的在前** —— 单词 `Flying` 和短语 `Flying high or`
 *    都从 L38W0 开始，让单词排在短语前面
 * 4. **还分不出就按创建时间**，最后按 id 兜底 ——
 *    两台设备算出来必须是同一个次序，不能靠数组本来的位置
 */
export function compareByText(a: TextOrdered, b: TextOrdered): number {
  const pa = parseAnchor(a.start)
  const pb = parseAnchor(b.start)

  // 孤儿一律沉底，彼此之间再按创建时间比
  if (!pa || !pb) {
    if (pa) return -1
    if (pb) return 1
    return tieBreak(a, b)
  }

  const byStart = pa[0] - pb[0] || pa[1] - pb[1]
  if (byStart !== 0) return byStart

  const ea = parseAnchor(a.end)
  const eb = parseAnchor(b.end)
  if (ea && eb) {
    const byEnd = ea[0] - eb[0] || ea[1] - eb[1]
    if (byEnd !== 0) return byEnd
  }

  return tieBreak(a, b)
}

function tieBreak(a: TextOrdered, b: TextOrdered): number {
  const ca = a.createdAt ?? 0
  const cb = b.createdAt ?? 0
  if (ca !== cb) return ca - cb
  return (a.id ?? '').localeCompare(b.id ?? '')
}

/** 按正文顺序排好的一份新数组（不动传进来的那个） */
export function sortByText<T extends Annotation | TextOrdered>(list: readonly T[]): T[] {
  return [...list].sort(compareByText)
}
