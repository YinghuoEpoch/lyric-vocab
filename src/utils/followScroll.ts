/**
 * 右侧笔记栏跟着正文滚：**屏幕上显示的正文里最后一个笔记，就是该落在的那一条**。
 *
 * 这里只回答「哪一条」，不管「怎么滚过去」—— 后者交给
 * `scrollIntoView({ block: 'center' })`，一行像素都不用自己算。
 *
 * ## ⚠️ 比的是**锚点**（精确到词），不是「第几行」
 *
 * 第一版拿的是「屏幕最下面是第几行」，而正文里**一个 `<p>` 就算一行**。
 * 歌词没问题（一行就是一行），导入的书就全错了 —— 一个自然段能占好几屏，于是：
 *
 * - 段落顶端一进屏幕，整段就算「露出来了」，段里所有笔记（哪怕还在屏幕下面
 *   老远）都算数 —— 用户报的「明明在屏幕下面还没显示，却在侧栏居中」
 * - 同一段里的笔记共用一个行号，**只有最后一条可能被标**，其余的
 *   「死活永远被跳过」
 * - 在长段里滚动时行号**根本不变**，于是一次也不上报 ——
 *   用户报的「平板横向模式下滑动正文，侧栏就是不会跟着滚动」
 *
 * **三个症状一个成因。** 现在比的是锚点 `L第几行W第几个词`：正文里每个单词
 * 都带着这个 id（见 LyricEditor 里 `<span id={anchorId}>`），长段里滚一点它就变。
 *
 * ## 落点规则
 *
 * 在**已按正文顺序排好**的清单里，取最后一条起点不晚于 `until` 的。于是：
 *
 * - 屏幕上有笔记 → 落在**屏幕上最后那条**（用户 2026-09-04 定的口径）
 * - 屏幕上一条也没有 → 落在**屏幕上方最近的那条**，免得竖线来回跳
 * - 还没读到第一条笔记 → 落在**第一条**上，列表顶端本来就是它
 *
 * ## 孤儿笔记跟不到
 *
 * 「原文已删除」的笔记按定义没有坐标，排在清单末尾。跟随只在有坐标的那一段里走。
 */

import { parseAnchor } from './annotationOrder'

/**
 * @param starts 每条笔记的起点锚点（`L第几行W第几个词`）。孤儿给 null / undefined
 * @param until  屏幕上最后一个还露着的单词的锚点。拿不到就给 null
 * @returns 该落在第几条；清单里一条有坐标的都没有时返回 -1
 */
export function findFollowIndex(
  starts: readonly (string | null | undefined)[],
  until: string | null | undefined
): number {
  const end = parseAnchor(until)
  let firstPositioned = -1
  let answer = -1

  for (let i = 0; i < starts.length; i++) {
    const pos = parseAnchor(starts[i])
    if (!pos) continue // 孤儿：没坐标，跟不到
    if (firstPositioned < 0) firstPositioned = i
    if (!end) continue // 量不到屏幕位置：一条都不算「已经露出来」，落在第一条上
    // 起点不晚于屏幕上最后那个词 —— 先看行，同一行再看第几个词
    if (pos[0] < end[0] || (pos[0] === end[0] && pos[1] <= end[1])) answer = i
    // 清单排好序了，一旦越过就不必再往下看
    else break
  }

  // 还没读到第一条笔记：落在第一条上
  return answer >= 0 ? answer : firstPositioned
}
