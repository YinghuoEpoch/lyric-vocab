/**
 * 新建的标注该排在第几位。
 *
 * 从前一律排在最后（`nextAnnotationOrder` = 最大值 + 1）——
 * 于是文中 `apple and ear` 里先标了 apple 和 ear，回头再标 and，
 * 它会跑到卡片列表的末尾，而不是待在 apple 和 ear 中间。
 *
 * 现在按**正文顺序**找位置：排在「正文里紧挨着它前面那条」的后面。
 *
 * 为什么不干脆整篇按正文重排 —— 那会把用户拖出来的顺序冲掉。
 * 只认新来的这一条该插在哪，别人的相对次序一概不动。
 */

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

export interface OrderedAnnotation {
  start?: string | null
  order: number
}

/**
 * 算出新标注的 order。
 *
 * `existing` 是同一篇文档、同一类型的现有标注（顺序无所谓，函数内部会排）。
 * 取值可能是小数 —— 排序只看大小，够用；用户下次拖动时会重新编成整数。
 */
export function insertionOrder(existing: OrderedAnnotation[], start: string | null): number {
  const list = [...existing].sort((a, b) => a.order - b.order)
  if (list.length === 0) return 0

  const last = list[list.length - 1]
  // 新的这条自己都没有位置（理论上不会发生），或者一条有位置的旧标注都没有：接在最后
  if (!parseAnchor(start)) return last.order + 1

  const positioned = list.filter((a) => parseAnchor(a.start))
  if (positioned.length === 0) return last.order + 1

  // 正文里紧挨着它前面的那条（取坐标最大的一条「在它之前」）
  let prev: OrderedAnnotation | null = null
  let next: OrderedAnnotation | null = null
  for (const a of positioned) {
    const cmp = compareAnchors(a.start, start)
    if (cmp <= 0) {
      if (!prev || compareAnchors(a.start, prev.start) > 0) prev = a
    } else {
      if (!next || compareAnchors(a.start, next.start) < 0) next = a
    }
  }

  if (prev) {
    // 排在 prev 后面：取 prev 与它在**当前显示顺序**里的下一位之间
    const i = list.indexOf(prev)
    const after = list[i + 1]
    return after ? (prev.order + after.order) / 2 : prev.order + 1
  }

  // 它是正文里最靠前的一条：排在 next 前面
  if (next) {
    const j = list.indexOf(next)
    const before = list[j - 1]
    return before ? (before.order + next.order) / 2 : next.order - 1
  }

  return last.order + 1
}
