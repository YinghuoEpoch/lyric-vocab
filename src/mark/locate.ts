import { buildWordList, getRangeText, type WordRef } from '../utils/reconcile'
import { tokenizeLine } from '../utils/tokenize'
import type { MarkPick } from './types'

/**
 * 把 AI 挑出来的词**定位回正文坐标**。
 *
 * 这是整个「一键划词」真正的难点 —— 挑词是 AI 的事，对不对得上是我们的事。
 * AI 返回的只是一串文字，而标注要挂在坐标上（第几行第几个词）。三种翻车方式：
 *
 * - 给了原形而正文是变形（take off / took off）
 * - 行号记错
 * - 干脆编一个文里没有的词
 *
 * 对策是**只认它自己给的那一行，在那行里精确查找，找不到就跳过并如实报数**。
 * 不去全文搜、不做模糊匹配 —— 猜错了会把线画到无关的词上，
 * 那比少划几个难受得多。
 *
 * 纯函数，不碰数据也不碰界面。
 */

/** 定位成功的一条：坐标 + 从正文里截出来的原文（不是 AI 给的那串字） */
export interface LocatedMark {
  pick: MarkPick
  startAnchorId: string
  endAnchorId: string
  /** 正文里的原样文字。AI 给的大小写可能不一致，一律以正文为准 */
  text: string
  /**
   * 单词还是短语 —— **按实际占了几个词算，不听 AI 的**。
   * AI 说是短语却只给了一个词的情况是有的，照它说的存会得到一条
   * 没有音标、却挂着「短语」标签的怪东西。
   */
  kind: 'word' | 'phrase'
}

export type SkipReason =
  /** 那一行里找不到这个写法 */
  | 'not-found'
  /** 这一篇里已经标过同样的词了（用户手标的，或本批前面已经划过） */
  | 'already-marked'

export interface LocateResult {
  located: LocatedMark[]
  skipped: Array<{ pick: MarkPick; reason: SkipReason }>
}

/** 比对用的规格化：只看字母数字，忽略大小写与撇号的两种写法 */
function normalize(s: string): string {
  return s.toLowerCase().replace(/['’]/g, '')
}

/** 把 AI 给的一串文字切成词序列，用的是和正文完全同一套分词规则 */
function tokensOf(text: string): string[] {
  return tokenizeLine(text)
    .filter((seg) => seg.type === 'en')
    .map((seg) => normalize(seg.text))
    .filter(Boolean)
}

/**
 * 在一行的词里找一段连续的、和 `tokens` 一致的词。
 * 返回起止下标；找不到返回 null。
 */
function findRun(lineWords: WordRef[], tokens: string[], fromIndex: number): [number, number] | null {
  if (tokens.length === 0) return null
  for (let i = fromIndex; i + tokens.length <= lineWords.length; i++) {
    let hit = true
    for (let k = 0; k < tokens.length; k++) {
      if (normalize(lineWords[i + k].word) !== tokens[k]) {
        hit = false
        break
      }
    }
    if (hit) return [i, i + tokens.length - 1]
  }
  return null
}

/**
 * @param content        正文
 * @param picks          AI 挑出来的
 * @param markedSpellings 这一篇里已经标过的写法（规格化过的）。
 *                        同一个词一篇里只划一次 —— 用户手标过的也算数。
 */
export function locateMarks(
  content: string,
  picks: MarkPick[],
  markedSpellings: ReadonlySet<string> = new Set()
): LocateResult {
  const words = buildWordList(content)
  const byLine = new Map<number, WordRef[]>()
  for (const w of words) {
    const list = byLine.get(w.line)
    if (list) list.push(w)
    else byLine.set(w.line, [w])
  }

  const located: LocatedMark[] = []
  const skipped: LocateResult['skipped'] = []
  // 已占用的写法：进来时那份 + 本批已经划上的
  const taken = new Set<string>(markedSpellings)

  for (const pick of picks) {
    const tokens = tokensOf(pick.text)
    const lineWords = byLine.get(pick.line)
    if (tokens.length === 0 || !lineWords) {
      skipped.push({ pick, reason: 'not-found' })
      continue
    }

    const run = findRun(lineWords, tokens, 0)
    if (!run) {
      skipped.push({ pick, reason: 'not-found' })
      continue
    }

    const [i, j] = run
    const startAnchorId = lineWords[i].anchorId
    const endAnchorId = lineWords[j].anchorId
    // 以正文为准取原文：AI 给的大小写、标点都可能不一致
    const text =
      i === j ? lineWords[i].word : getRangeText(content, words, startAnchorId, endAnchorId)
    const key = normalize(text)

    if (taken.has(key)) {
      skipped.push({ pick, reason: 'already-marked' })
      continue
    }

    taken.add(key)
    located.push({ pick, startAnchorId, endAnchorId, text, kind: i === j ? 'word' : 'phrase' })
  }

  return { located, skipped }
}
