/**
 * 划一段话时，紧贴在两端外面的标点。
 *
 * 背景：笔记的坐标是「第几行第几个词」，所以划出来的范围**两端一定落在词上**。
 * 取原文是从第一个词的头一个字母切到最后一个词的末一个字母 ——
 * 词与词之间的标点夹在里面所以留下了，但贴在最外面的那两个落在切口之外，
 * 天然带不进来：`“I like you,” he said.` 整句划上，存下来的是
 * `I like you,” he said`，**开头的引号和句末的句号都丢了**。
 *
 * 这里的两张表就是用来把那两头补回来的。**分方向**是关键：
 * 往左只吃「开头类」，往右只吃「收尾类」，句号不在开头类里，
 * 所以 `He smiled. “I like you...` 从 I 起划，只会吃到 `“`，
 * 前一句的句号碰都不碰。若换成「一路扩到空格为止」就挡不住这种情况。
 *
 * 撇号（`'` `’`）**两张表里都有，但不参与剥离**（见 stripEdgePunctuation）——
 * 分词和对账那边早就有一套专门的撇号规则（rock 'n' roll 的 'n、students' 的尾撇号、
 * don't 拆出来的 n't），这里只负责补，不去动它。
 */

import type { Segment } from './tokenize'

/** 开头类：只可能出现在一段话前面 */
const OPENERS = `"'“‘«‹「『([{¿¡`

/** 收尾类：只可能出现在一段话后面 */
const CLOSERS = `"'”’»›」』)]}.,!?;:…。，！？；：、`

/** 正则里当字符集用，先把有特殊含义的转义掉 */
function charClass(chars: string): string {
  return chars.replace(/[\\\]^-]/g, '\\$&')
}

const TRAILING_OPENERS = new RegExp(`[${charClass(OPENERS)}]+$`)
const LEADING_CLOSERS = new RegExp(`^[${charClass(CLOSERS)}]+`)

/**
 * 一段文字**末尾**紧贴着的「开头类」符号，属于它后面那个词。
 * `He smiled. “` → `“`（句号是收尾类，扫到就停）
 */
export function trailingOpeners(text: string): string {
  return text.match(TRAILING_OPENERS)?.[0] ?? ''
}

/**
 * 一段文字**开头**紧贴着的「收尾类」符号，属于它前面那个词。
 * `,” he` → `,”`
 */
export function leadingClosers(text: string): string {
  return text.match(LEADING_CLOSERS)?.[0] ?? ''
}

/**
 * 剥掉一段文字两头的标点。给**短语**用。
 *
 * 同一段选区既能存成句摘也能存成短语，两边共用一份文字。句摘要带上引号句号才完整，
 * 短语不能带 —— 短语要拿去词典查真人录音，而 `he said.` 这样带着句号是查不到的，
 * 整条会白白落回机器音（和第二十七节弯撇号那个是同一类毛病）。
 *
 * **撇号不剥**：`students'` 的尾撇号在这个改动之前就一直留着，剥掉是另一件事，
 * 不顺手做。
 */
const APOSTROPHES = `'’`
const STRIP_CHARS = [...new Set([...OPENERS, ...CLOSERS])]
  .filter((c) => !APOSTROPHES.includes(c))
  .join('')
const EDGE_PUNCTUATION = new RegExp(
  `^[\\s${charClass(STRIP_CHARS)}]+|[\\s${charClass(STRIP_CHARS)}]+$`,
  'g'
)

export function stripEdgePunctuation(text: string): string {
  return text.replace(EDGE_PUNCTUATION, '')
}

/**
 * 把「其它」段两头的标点拆成独立的段，并标出它归左边还是右边的词。
 *
 * 为的是正文里那条句摘虚线能盖住引号句号。不拆不行：`He smiled. “I like...`
 * 里的 `. “` 是**一整段**，整段画线会连前一句的句号一起画，不画又盖不到引号。
 * 拆开之后 `.` 归 smiled、`“` 归 I，各画各的。
 *
 * 拆法和 getRangeText 补两头用的是同一对规则，所以「看到的线」和「存下来的字」
 * 永远对得上。缩写后缀（`'s`、`n't`）不拆 —— 那是词的一部分。
 */
export type EdgeRole = 'open' | 'close'
export interface EdgeSegment extends Segment {
  /** open：归后面那个词；close：归前面那个词 */
  edge?: EdgeRole
}

export function splitEdgePunctuation(segments: Segment[]): EdgeSegment[] {
  const out: EdgeSegment[] = []
  for (const seg of segments) {
    if (seg.type !== 'other' || seg.contraction) {
      out.push(seg)
      continue
    }
    const close = leadingClosers(seg.text)
    const rest = seg.text.slice(close.length)
    const open = trailingOpeners(rest)
    const middle = rest.slice(0, rest.length - open.length)

    if (close) out.push({ type: 'other', text: close, edge: 'close' })
    if (middle) out.push({ type: 'other', text: middle })
    if (open) out.push({ type: 'other', text: open, edge: 'open' })
  }
  return out
}
