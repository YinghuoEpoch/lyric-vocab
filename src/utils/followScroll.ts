/**
 * 右侧笔记栏跟着正文滚：**屏幕上显示的正文里最后一个笔记，就是该落在的那一条**。
 *
 * 这里只回答「哪一条」，不管「怎么滚过去」—— 后者交给
 * `scrollIntoView({ block: 'nearest' })`，浏览器自己就懂「看得见就别动，
 * 看不见才滚，而且只滚到刚好露出来」，不必自己算像素。
 *
 * ## 传进来的是屏幕**最下面**那行，于是落点就是「屏幕上最后一条笔记」
 *
 * 用户 2026-09-04 定的口径。这个函数本身只干一件事：**在排好序的清单里找出
 * 最后一条行号不超过 line 的**。传顶行进来它就是「屏幕上方最后一条」，
 * 传底行进来它就是「屏幕上最后一条」—— 现在传的是底行。
 *
 * 改口径的由头是两个症状（都是用户报的）：亲手划完一个词、竖线却不在它身上；
 * 短语好像从来不被标记。根子同一个 —— 新划的那条在屏幕**中段**，行号比顶行大。
 *
 * 屏幕上一条笔记也没有时，落在**屏幕上方最近的那条**（也就是这个函数的自然结果），
 * 免得竖线来回跳。还没读到第一条笔记时落在**第一条**上 ——
 * 此时前面一条都没有，而列表顶端本来就是它。
 *
 * ## 孤儿笔记跟不到
 *
 * 「原文已删除」的笔记按定义没有正文坐标（`start` 解析不出来），排在清单末尾。
 * 跟随只在有坐标的那一段里走，所以读到全文最后时，竖线停在**最后一条有坐标的**
 * 笔记上，孤儿在它下面。这是有意的：跟不到的东西不该硬跟。
 */

import { parseAnchor } from './annotationOrder'

/**
 * 在一份**已按正文顺序排好**的清单里，找出最后一条行号不超过 `line` 的。
 *
 * @param starts 每条笔记的起点坐标（`L第几行W第几个词`）。孤儿给 null / undefined
 * @param line   正文里屏幕最下面还露着的是第几行（和 `data-line-index` 同一套编号）
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
