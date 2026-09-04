/**
 * 右侧笔记栏跟着正文滚：**读到第几行，就该落在哪一条笔记上**。
 *
 * 这里只回答「哪一条」，不管「怎么滚过去」—— 后者交给
 * `scrollIntoView({ block: 'nearest' })`，浏览器自己就懂「看得见就别动，
 * 看不见才滚，而且只滚到刚好露出来」，不必自己算像素。
 *
 * ## 「最近」取的是**前面那条**，不是绝对距离最近的那条
 *
 * 用户 2026-09-04 拍的板。举例：笔记在第 12 行和第 38 行，你读到第 30 行 ——
 * 落在**第 12 行**那条上，而不是「差 8 行更近」的第 38 行。
 *
 * 理由：这样侧栏永远是「竖线以上读过、以下还没读到」，单调、不回跳。
 * 按绝对距离算的话，空档正中间会有一个翻页点 —— 从第 25 行读到第 26 行，
 * 当前那条会一下子从第 12 条跳到第 38 条。
 *
 * 一个例外：还没读到第一条笔记时（在它上面），落在**第一条**上 ——
 * 此时没有「前面那条」，而列表顶端本来就是它。
 *
 * ## 孤儿笔记跟不到
 *
 * 「原文已删除」的笔记按定义没有正文坐标（`start` 解析不出来），排在清单末尾。
 * 跟随只在有坐标的那一段里走，所以读到全文最后时，竖线停在**最后一条有坐标的**
 * 笔记上，孤儿在它下面。这是有意的：跟不到的东西不该硬跟。
 */

import { parseAnchor } from './annotationOrder'

/**
 * 在一份**已按正文顺序排好**的清单里，找出读到第 `line` 行时该落在哪一条。
 *
 * @param starts 每条笔记的起点坐标（`L第几行W第几个词`）。孤儿给 null / undefined
 * @param line   正文里屏幕最上面露出来的是第几行（和 `data-line-index` 同一套编号）
 * @returns 该落在第几条；清单里一条有坐标的都没有时返回 -1
 */
export function findFollowIndex(
  starts: readonly (string | null | undefined)[],
  line: number
): number {
  let firstPositioned = -1
  let answer = -1

  for (let i = 0; i < starts.length; i++) {
    const pos = parseAnchor(starts[i])
    if (!pos) continue // 孤儿：没坐标，跟不到
    if (firstPositioned < 0) firstPositioned = i
    if (pos[0] <= line) answer = i
    // 清单是排好序的，一旦越过当前行，后面的只会更靠后
    else break
  }

  // 还没读到第一条笔记：落在第一条上
  return answer >= 0 ? answer : firstPositioned
}
