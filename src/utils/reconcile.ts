import { tokenizeLine } from './tokenize'
import type { NotesMap, Sentence } from '../types'

/**
 * 笔记「对账」：正文被编辑之后，把笔记重新挂到正确的位置上。
 *
 * 背景：笔记挂在 anchorId（`L第几行W第几个词`）这个「坐标」上，而不是挂在单词本身。
 * 所以只要正文一改，坐标就会错位 —— 在前面插一行，后面所有笔记整体挪一格；
 * 删掉一个词，同一行后面的词全部往前顶一格。
 *
 * 做法：进入编辑模式时拍一份正文快照，退出时拿「改之前」和「改之后」两版对比，
 * 算出「旧的第 N 个词 = 新的第几个词」的完整对照表，然后照表把笔记搬过去。
 * 对照表是按序列结构算的，不比较拼写，所以：
 * - 整体位移能被完整识别，笔记全部自动跟随
 * - 重复单词不会张冠李戴（第 17 个 "I" 对应的就是第 17 个 "I"）
 * 只有在新文本里彻底找不到对应的词，才判定为「原文没了」，交给上层去问用户。
 */

/** LCS 的计算量上限；超过就退回快速近似算法，避免超长文档卡住 */
const LCS_CELL_CAP = 1_000_000

export interface WordRef {
  anchorId: string
  word: string
}

/**
 * 把正文拆成「文档顺序下的英文词列表」，并算出每个词的 anchorId。
 *
 * 必须和阅读视图里的编号规则完全一致，否则对照表算出来也对不上，
 * 所以这里是唯一的一份实现，LyricEditor 也从这里取。
 */
export function buildWordList(content: string): WordRef[] {
  const lines = content ? content.split(/\n/) : ['']
  const out: WordRef[] = []
  lines.forEach((line, lineIndex) => {
    let wordIndex = 0
    for (const seg of tokenizeLine(line)) {
      if (seg.type === 'en') {
        out.push({ anchorId: `L${lineIndex}W${wordIndex}`, word: seg.text })
        wordIndex++
      }
    }
  })
  return out
}

/**
 * 把旧词序列对齐到新词序列。
 * 返回一个和 oldWords 等长的数组：第 i 项是该词在新序列中的下标，null 表示没了。
 */
export function alignWords(oldWords: string[], newWords: string[]): Array<number | null> {
  // 比较时统一小写：改个大小写不该让笔记失联
  const a = oldWords.map((w) => w.toLowerCase())
  const b = newWords.map((w) => w.toLowerCase())
  const result: Array<number | null> = new Array(a.length).fill(null)

  // 掐头：从开头往后，一样的部分直接一一对应
  let start = 0
  while (start < a.length && start < b.length && a[start] === b[start]) {
    result[start] = start
    start++
  }

  // 去尾：从末尾往前，一样的部分直接一一对应
  let endA = a.length - 1
  let endB = b.length - 1
  while (endA >= start && endB >= start && a[endA] === b[endB]) {
    result[endA] = endB
    endA--
    endB--
  }

  // 中间这段才是真正改动过的部分，通常很短
  const midA = a.slice(start, endA + 1)
  const midB = b.slice(start, endB + 1)
  if (midA.length === 0 || midB.length === 0) return result

  const pairs =
    midA.length * midB.length <= LCS_CELL_CAP ? lcsPairs(midA, midB) : greedyPairs(midA, midB)

  for (const [i, j] of pairs) result[start + i] = start + j
  return result
}

/** 最长公共子序列，返回配对的下标 [旧, 新]。结果是严格递增的，不会两个旧词抢同一个新词。 */
function lcsPairs(a: string[], b: string[]): Array<[number, number]> {
  const n = a.length
  const m = b.length
  const width = m + 1
  const dp = new Int32Array((n + 1) * width)

  for (let i = n - 1; i >= 0; i--) {
    for (let j = m - 1; j >= 0; j--) {
      dp[i * width + j] =
        a[i] === b[j]
          ? dp[(i + 1) * width + (j + 1)] + 1
          : Math.max(dp[(i + 1) * width + j], dp[i * width + (j + 1)])
    }
  }

  const pairs: Array<[number, number]> = []
  let i = 0
  let j = 0
  while (i < n && j < m) {
    if (a[i] === b[j]) {
      pairs.push([i, j])
      i++
      j++
    } else if (dp[(i + 1) * width + j] >= dp[i * width + (j + 1)]) {
      i++
    } else {
      j++
    }
  }
  return pairs
}

/**
 * 超长文档的近似对齐：游标只能往前走，按顺序给每个旧词找下一个还没被占用的同名新词。
 * 保证不会多条笔记挤到同一个词上，代价是遇到大段改写时不如 LCS 精确。
 */
function greedyPairs(a: string[], b: string[]): Array<[number, number]> {
  const positions = new Map<string, number[]>()
  b.forEach((w, j) => {
    const list = positions.get(w)
    if (list) list.push(j)
    else positions.set(w, [j])
  })

  const used = new Map<string, number>()
  const pairs: Array<[number, number]> = []
  let minJ = 0

  for (let i = 0; i < a.length; i++) {
    const list = positions.get(a[i])
    if (!list) continue
    let k = used.get(a[i]) ?? 0
    while (k < list.length && list[k] < minJ) k++
    if (k >= list.length) {
      used.set(a[i], k)
      continue
    }
    pairs.push([i, list[k]])
    minJ = list[k] + 1
    used.set(a[i], k + 1)
  }
  return pairs
}

export interface ReconcileResult {
  /** 重新挂好坐标的笔记 */
  notes: NotesMap
  /** 重新框好范围的句摘（仅当前文档的） */
  sentences: Sentence[]
  /** 原文已不存在、等待用户确认的单词笔记（anchorId -> 单词） */
  orphanNotes: Array<{ anchorId: string; word: string }>
  /** 原文已不存在、等待用户确认的句摘 */
  orphanSentences: Sentence[]
  /** 是否真的有变化，没变化就不用惊动上层 */
  changed: boolean
}

/**
 * 对账一篇文档。
 *
 * @param oldContent 编辑前的正文快照
 * @param newContent 编辑后的正文
 * @param notes      该文档的全部单词笔记
 * @param sentences  该文档的全部句摘
 */
export function reconcilePage(
  oldContent: string,
  newContent: string,
  notes: NotesMap,
  sentences: Sentence[]
): ReconcileResult {
  const oldList = buildWordList(oldContent)
  const newList = buildWordList(newContent)
  const mapping = alignWords(
    oldList.map((w) => w.word),
    newList.map((w) => w.word)
  )

  const oldIndexOf = new Map<string, number>()
  oldList.forEach((w, i) => oldIndexOf.set(w.anchorId, i))

  /** 旧坐标 -> 新坐标；null 表示这个词在新正文里没了 */
  const remap = (anchorId: string): string | null => {
    const i = oldIndexOf.get(anchorId)
    // 坐标在旧正文里就已经不存在（历史遗留的失效笔记）：同样按「没了」处理
    if (i === undefined) return null
    const j = mapping[i]
    return j === null || j === undefined ? null : newList[j].anchorId
  }

  const nextNotes: NotesMap = {}
  const orphanNotes: Array<{ anchorId: string; word: string }> = []
  let changed = false

  for (const anchorId of Object.keys(notes)) {
    const note = notes[anchorId]
    const target = remap(anchorId)
    if (target === null) {
      orphanNotes.push({ anchorId, word: note?.word ?? '' })
      changed = true
      continue
    }
    nextNotes[target] = note
    if (target !== anchorId) changed = true
  }

  const nextSentences: Sentence[] = []
  const orphanSentences: Sentence[] = []

  for (const sentence of sentences) {
    const nextStart = remap(sentence.startAnchorId)
    const nextEnd = remap(sentence.endAnchorId)

    // 两头都在才算这句话还完整；只剩一头的半句留着没有意义
    if (nextStart === null || nextEnd === null) {
      orphanSentences.push(sentence)
      changed = true
      continue
    }

    if (nextStart === sentence.startAnchorId && nextEnd === sentence.endAnchorId) {
      nextSentences.push(sentence)
      continue
    }

    // 范围变了：连原文一起按新位置重新取一遍，保证列表里显示的文字是准的
    const i = newList.findIndex((w) => w.anchorId === nextStart)
    const j = newList.findIndex((w) => w.anchorId === nextEnd)
    const [lo, hi] = i <= j ? [i, j] : [j, i]
    const text = newList
      .slice(lo, hi + 1)
      .map((w) => w.word)
      .join(' ')

    nextSentences.push({ ...sentence, startAnchorId: nextStart, endAnchorId: nextEnd, text })
    changed = true
  }

  return { notes: nextNotes, sentences: nextSentences, orphanNotes, orphanSentences, changed }
}
