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

/**
 * 孤儿笔记的键前缀。
 *
 * 孤儿按定义就是「正文里已经没有对应内容」的笔记，也就是没有位置。
 * 但笔记表是以坐标为键的，如果继续把孤儿留在它的老坐标上，会出两种事故：
 * 1. 那个坐标并没消失，只是换了别的词站上去 —— 于是给错误的词画了下划线
 * 2. 若该坐标已被另一条正常笔记占用，两者互相覆盖 —— 用户选了「保留」，笔记却没了
 * 所以孤儿一律改用这个前缀开头的键，永远不可能和真实坐标撞车，
 * 正文里也不会有任何词能匹配上它。
 */
const ORPHAN_PREFIX = 'orphan:'

/** 这个键是不是孤儿键（而非真实坐标） */
export function isOrphanKey(key: string): boolean {
  return key.startsWith(ORPHAN_PREFIX)
}

/** 生成一个新的孤儿键 */
export function makeOrphanKey(): string {
  return ORPHAN_PREFIX + Date.now().toString(36) + Math.random().toString(36).slice(2, 8)
}

export interface WordRef {
  anchorId: string
  word: string
  /**
   * 紧贴在词前面的撇号，如 rock 'n' roll 里的 'n。
   */
  prefix?: string
  /**
   * 紧贴在词后面的撇号部分：拆出去的缩写后缀（she 的 's、do 的 n't），
   * 或所有格的尾撇号（students'）。
   *
   * 选词、记笔记只认 word；重建句摘原文时要带上它，否则
   * "I don't know" 会被拼成 "I do know"。
   */
  suffix?: string
}

/** 词 + 紧贴它的撇号，用于还原成人能读的原文 */
export function wordWithSuffix(w: WordRef): string {
  return `${w.prefix ?? ''}${w.word}${w.suffix ?? ''}`
}

/** 把一段连续的词还原成原文 */
export function joinWords(words: WordRef[]): string {
  return words.map(wordWithSuffix).join(' ')
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
    // 上一段「其它」文本若以撇号结尾，说明这个撇号贴着下一个词（rock 'n' roll 的 'n）
    let pendingPrefix = ''

    for (const seg of tokenizeLine(line)) {
      if (seg.type === 'en') {
        const ref: WordRef = { anchorId: `L${lineIndex}W${wordIndex}`, word: seg.text }
        if (pendingPrefix) ref.prefix = pendingPrefix
        out.push(ref)
        wordIndex++
        pendingPrefix = ''
        continue
      }

      pendingPrefix = ''
      if (seg.type !== 'other') continue

      const last = out[out.length - 1]
      if (seg.contraction) {
        // 从词里拆出来的缩写后缀，直接挂回那个词
        if (last) last.suffix = (last.suffix ?? '') + seg.text
        continue
      }

      // 紧跟在词后面的撇号：所有格 students'
      const leading = seg.text.match(/^['’]+/)
      if (leading && last && !last.suffix) last.suffix = leading[0]

      // 紧贴下一个词的撇号
      const trailing = seg.text.match(/['’]+$/)
      if (trailing) pendingPrefix = trailing[0]
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
  /**
   * 处理完毕的笔记：含跟随移动的、被救回的、以及仍然找不到原文但用户此前已选择保留的。
   * 不含本次新产生的孤儿 —— 那些要先问过用户才决定去留。
   */
  notes: NotesMap
  sentences: Sentence[]
  /** 本次新变成孤儿的单词笔记，需要询问用户 */
  newOrphanNotes: Array<{ anchorId: string; word: string }>
  /** 本次新变成孤儿的句摘，需要询问用户 */
  newOrphanSentences: Sentence[]
  /** 是否真的有变化，没变化就不必惊动上层 */
  changed: boolean
}

/** 去掉「原文已删除」标记 */
function unmark<T extends { orphaned?: boolean }>(item: T): T {
  if (!item.orphaned) return item
  const { orphaned: _removed, ...rest } = item
  return rest as T
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
    if (i === undefined) return null
    const j = mapping[i]
    return j === null || j === undefined ? null : newList[j].anchorId
  }

  const nextNotes: NotesMap = {}
  const newOrphanNotes: Array<{ anchorId: string; word: string }> = []
  const claimed = new Set<string>()
  let changed = false

  // 第一遍：正常跟随。先把位置占掉，第二遍救人时才知道哪些位置还空着。
  const pendingRescue: Array<[string, NotesMap[string]]> = []
  for (const anchorId of Object.keys(notes)) {
    const note = notes[anchorId]

    // 已标记「原文已删除」的：它的坐标早就失效了，哪怕这个坐标碰巧还存在，
    // 上面站着的也是别的词。所以完全不看坐标，留到第二遍按拼写重新找。
    if (note?.orphaned) {
      pendingRescue.push([anchorId, note])
      continue
    }

    const target = remap(anchorId)
    if (target !== null) {
      nextNotes[target] = note
      claimed.add(target)
      if (target !== anchorId) changed = true
      continue
    }

    newOrphanNotes.push({ anchorId, word: note?.word ?? '' })
    changed = true
  }

  // 第二遍：已标记的孤儿，如果原文里又出现了这个词（比如用户把拼错的词改回来了），
  // 就重新挂上去并清掉标记；否则原样留在老坐标上，继续带着标记。
  for (const [anchorId, note] of pendingRescue) {
    const target = note.word
      ? newList.find(
          (w) => !claimed.has(w.anchorId) && w.word.toLowerCase() === note.word.trim().toLowerCase()
        )
      : undefined

    if (target) {
      nextNotes[target.anchorId] = unmark(note)
      claimed.add(target.anchorId)
      changed = true
    } else {
      // 仍然找不到：留在孤儿键下。老版本可能把孤儿存在真实坐标上，这里顺手迁移过去。
      const key = isOrphanKey(anchorId) ? anchorId : makeOrphanKey()
      nextNotes[key] = note
      if (key !== anchorId) changed = true
    }
  }

  const nextSentences: Sentence[] = []
  const newOrphanSentences: Sentence[] = []

  /**
   * 一条句摘在新正文里还剩下哪一段，返回 [起, 止] 在 newList 中的下标。
   *
   * 逐个检查旧范围内的每个词，把还活着的挑出来，用其中最靠前和最靠后的两个
   * 当作新的起止 —— 也就是「范围往里收缩」。
   * 剩下不足两个词就判定为没了：一个词的「句摘」已经不是句子。
   */
  const survivingRange = (sentence: Sentence): [number, number] | null => {
    const from = oldIndexOf.get(sentence.startAnchorId)
    const to = oldIndexOf.get(sentence.endAnchorId)
    // 起止坐标在旧正文里就已经失效（历史遗留的坏数据）：无从判断，按没了处理
    if (from === undefined || to === undefined) return null

    const [lo, hi] = from <= to ? [from, to] : [to, from]
    let first: number | null = null
    let last: number | null = null

    for (let i = lo; i <= hi; i++) {
      const j = mapping[i]
      if (j === null || j === undefined) continue
      if (first === null) first = j
      last = j
    }

    if (first === null || last === null || last - first < 1) return null
    return [first, last]
  }

  for (const sentence of sentences) {
    // 同上：已标记的孤儿不看坐标，直接拿存下来的原文去全文找。
    if (sentence.orphaned) {
      const revived = locateSequence(newList, sentence.text)
      if (revived) {
        nextSentences.push(unmark({ ...sentence, ...revived }))
        changed = true
      } else {
        nextSentences.push(sentence)
      }
      continue
    }

    // 看整个范围里还剩下哪些词，而不是只看头尾两个。
    // 只看头尾的话，删掉句子的第一个词就会让整条句摘报废 —— 可其余部分明明还好好的。
    const survivors = survivingRange(sentence)

    if (survivors === null) {
      newOrphanSentences.push(sentence)
      changed = true
      continue
    }

    const [lo, hi] = survivors
    const nextStart = newList[lo].anchorId
    const nextEnd = newList[hi].anchorId

    if (nextStart === sentence.startAnchorId && nextEnd === sentence.endAnchorId) {
      nextSentences.push(sentence)
      continue
    }

    // 范围缩了或挪了：连原文一起按新位置重新取一遍，保证列表里显示的文字是准的
    const text = joinWords(newList.slice(lo, hi + 1))

    nextSentences.push(unmark({ ...sentence, startAnchorId: nextStart, endAnchorId: nextEnd, text }))
    changed = true
  }

  return { notes: nextNotes, sentences: nextSentences, newOrphanNotes, newOrphanSentences, changed }
}

/** 在词表里找出与给定原文完全一致的一段连续词，返回它的起止坐标 */
function locateSequence(
  list: WordRef[],
  text: string
): { startAnchorId: string; endAnchorId: string } | null {
  const target = text.trim().toLowerCase().split(/\s+/).filter(Boolean)
  if (target.length === 0) return null

  for (let i = 0; i + target.length <= list.length; i++) {
    let hit = true
    for (let k = 0; k < target.length; k++) {
      if (wordWithSuffix(list[i + k]).toLowerCase() !== target[k]) {
        hit = false
        break
      }
    }
    if (hit) {
      return { startAnchorId: list[i].anchorId, endAnchorId: list[i + target.length - 1].anchorId }
    }
  }
  return null
}
