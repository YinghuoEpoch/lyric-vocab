import { chunk } from '../enrich/runner'
import { locateMarks, type LocatedMark } from './locate'
import type { MarkLine, MarkOptions, Marker } from './types'

/**
 * 分批跑一篇文档的「一键划词」。
 *
 * 和填充层同样的三条要求：分批、可中断、边跑边落库。
 * 多一条独有的：**定位在这里做**，AI 说了什么和最后划上了什么是两回事，
 * 差额要如实报给用户。
 */

/** 每批送多少行。太多会让单次响应过长被截断，太少则来回请求次数多、更贵 */
export const LINE_BATCH_SIZE = 40

export interface MarkProgress {
  /** 已处理的行数 */
  done: number
  total: number
  /** 已经划上的条数 */
  marked: number
  /** AI 挑了但没对上原文的条数 */
  missed: number
}

/**
 * 把正文切成送给 AI 的行。
 *
 * **只送含英文词的行**，中文对照行送过去纯属浪费；
 * 但行号一律用正文里的真实行号 —— 定位那一步就靠它，不能重新编号。
 */
export function buildMarkLines(content: string): MarkLine[] {
  const lines = content ? content.split(/\r?\n/) : []
  const out: MarkLine[] = []
  lines.forEach((text, line) => {
    if (/[a-zA-ZÀ-ÿ]/.test(text)) out.push({ line, text })
  })
  return out
}

export interface RunMarkOptions {
  marker: Marker
  content: string
  options: MarkOptions
  /** 这一篇里已经标过的写法（规格化过的小写），同一个词不重复划 */
  markedSpellings: Set<string>
  /** 每批定位完立刻交给上层落库，中途中断也不白跑 */
  onBatch: (located: LocatedMark[]) => void | Promise<void>
  onProgress?: (p: MarkProgress) => void
  signal?: AbortSignal
}

/**
 * 跑完一篇。中断时抛 AbortError；此前每批的结果都已经交出去了。
 *
 * `markedSpellings` 会被**就地补充** —— 前一批划上的词，后一批不能再划一次。
 */
export async function runMark({
  marker,
  content,
  options,
  markedSpellings,
  onBatch,
  onProgress,
  signal
}: RunMarkOptions): Promise<MarkProgress> {
  const lines = buildMarkLines(content)
  const progress: MarkProgress = { done: 0, total: lines.length, marked: 0, missed: 0 }
  onProgress?.({ ...progress })

  for (const batch of chunk(lines, LINE_BATCH_SIZE)) {
    if (signal?.aborted) throw new DOMException('已取消', 'AbortError')

    const picks = await marker.pick(batch, options, signal)
    // 定位对着**整篇正文**做，不是只对这一批的行 —— 行号是全篇的真实行号
    const { located, skipped } = locateMarks(content, picks, markedSpellings)
    for (const m of located) markedSpellings.add(m.text.toLowerCase().replace(/['’]/g, ''))

    await onBatch(located)

    progress.done += batch.length
    progress.marked += located.length
    progress.missed += skipped.length
    onProgress?.({ ...progress })
  }

  return progress
}
