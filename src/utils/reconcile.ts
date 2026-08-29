import { tokenizeLine } from './tokenize'
import type { Annotation } from '../types'

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
  /** 该词在第几行 */
  line: number
  /** 词在本行内的起止字符位置（不含前后撇号） */
  start: number
  end: number
}

/** 词 + 紧贴它的撇号。用于按词比对，不用于还原原文。 */
export function wordWithSuffix(w: WordRef): string {
  return `${w.prefix ?? ''}${w.word}${w.suffix ?? ''}`
}

/**
 * 还原一段范围的原文。
 *
 * 直接从原文里按字符位置截取，而不是把词用空格拼回去 —— 拼的方式是有损的，
 * 数字、标点、原始空格全都会丢（"I have 3 cats" 会变成 "I have cats"）。
 * 截取则是原样保留。
 *
 * 跨行时会跳过不含英文的行（通常是中文对照行），与从前的行为保持一致。
 */
export function getRangeText(
  content: string,
  words: WordRef[],
  startAnchorId: string,
  endAnchorId: string
): string {
  const i = words.findIndex((w) => w.anchorId === startAnchorId)
  const j = words.findIndex((w) => w.anchorId === endAnchorId)
  if (i === -1 || j === -1) return ''

  const [a, b] = i <= j ? [words[i], words[j]] : [words[j], words[i]]
  const from = a.start - (a.prefix?.length ?? 0)
  let to = b.end + (b.suffix?.length ?? 0)
  const lines = content ? content.split(/\r?\n/) : ['']

  // 结尾若只剩数字和标点（"...hit in 2020"），一并带上。
  // 纯数字不是单词、选不中，范围只能停在 in，不补的话尾巴就没了。
  // 限定「剩余部分不含字母」，避免把后面另一句话吞进来。
  const tail = (lines[b.line] ?? '').slice(to)
  if (tail && !/[a-zA-ZÀ-ÿ]/.test(tail) && /\d/.test(tail)) {
    to = (lines[b.line] ?? '').length
  }

  if (a.line === b.line) return (lines[a.line] ?? '').slice(from, to).trim()

  const parts: string[] = [(lines[a.line] ?? '').slice(from)]
  for (let k = a.line + 1; k < b.line; k++) parts.push(lines[k] ?? '')
  parts.push((lines[b.line] ?? '').slice(0, to))

  return parts
    .filter((p) => /[a-zA-ZÀ-ÿ]/.test(p)) // 跳过纯中文的对照行
    .map((p) => p.trim())
    .filter(Boolean)
    .join(' ')
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
    let offset = 0

    for (const seg of tokenizeLine(line)) {
      const segStart = offset
      offset += seg.text.length

      if (seg.type === 'en') {
        const ref: WordRef = {
          anchorId: `L${lineIndex}W${wordIndex}`,
          word: seg.text,
          line: lineIndex,
          start: segStart,
          end: segStart + seg.text.length
        }
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


// ============================================================
// 对账：正文改了以后，把标注重新挂回它该在的位置
//
// 关键在于「怎么记住谁是谁」：每条标注有自己的 id，
// 对账只是**更新它身上的位置属性**，不是把它搬到别的格子里去。
//
// 换代之前那一版是拿坐标当身份的（键就是「第几行第几个词」，
// 搬家 = 换键），于是有三件事必须操心，现在都不存在了：
// - 孤儿不必再编造假坐标 orphan:xxx，位置记成 null 就行
// - 不会有「两条笔记抢同一个坐标」这种事故，因为坐标不再是身份
// - 单词和句子不必分两套写，只差「点」和「范围」
//
// 旧那一版（reconcilePage）已于 2026-08-30 连同它的测试一起删掉，
// 需要考古的话在 git 历史里。
// ============================================================

export interface AnnotationReconcileResult {
  /**
   * 处理完毕的标注：跟随移动的、被救回的、以及仍然找不到原文但此前已选择保留的。
   * 不含本次新产生的孤儿 —— 那些要先问过用户才决定去留。
   */
  annotations: Annotation[]
  /** 本次新变成孤儿的，需要询问用户。用户选「保留」就把位置置空后写回 */
  newOrphans: Annotation[]
  /** 是否真的有变化，没变化就不必惊动上层 */
  changed: boolean
}

/**
 * 对账一篇文档的标注。
 *
 * @param oldContent 编辑前的正文快照
 * @param newContent 编辑后的正文
 * @param annotations 该文档的全部标注
 */
export function reconcileAnnotations(
  oldContent: string,
  newContent: string,
  annotations: Annotation[]
): AnnotationReconcileResult {
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

  /**
   * 一段范围在新正文里还剩下哪一截，返回 [起, 止] 在 newList 中的下标。
   *
   * 逐个检查旧范围内的每个词，把还活着的挑出来，用最靠前和最靠后的两个当新的起止 ——
   * 也就是「范围往里收缩」。只看头尾的话，删掉第一个词就会让整条报废，
   * 可其余部分明明还好好的。剩下不足两个词则判定为没了：一个词不成句。
   */
  const survivingRange = (startId: string, endId: string): [number, number] | null => {
    const from = oldIndexOf.get(startId)
    const to = oldIndexOf.get(endId)
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

  const kept: Annotation[] = []
  const newOrphans: Annotation[] = []
  /** 已标记「原文已删除」的，留到第二遍按原文去找 */
  const pendingRescue: Annotation[] = []
  /**
   * 已被单词标注占用的坐标。
   *
   * 只收单词，不收范围 —— 一条句摘的范围里本来就会盖着若干个单词标注，
   * 把范围也算作「占用」的话，那些单词就再也救不回来了。
   */
  const claimedWords = new Set<string>()
  let changed = false

  // 第一遍：正常跟随。先把位置占掉，第二遍救人时才知道哪些位置还空着。
  for (const a of annotations) {
    if (a.start === null || a.end === null) {
      pendingRescue.push(a)
      continue
    }

    if (a.type === 'word') {
      const target = remap(a.start)
      if (target === null) {
        newOrphans.push(a)
        changed = true
        continue
      }
      claimedWords.add(target)
      if (target === a.start && target === a.end) {
        kept.push(a)
      } else {
        kept.push({ ...a, start: target, end: target })
        changed = true
      }
      continue
    }

    const survivors = survivingRange(a.start, a.end)
    if (survivors === null) {
      newOrphans.push(a)
      changed = true
      continue
    }

    const [lo, hi] = survivors
    const nextStart = newList[lo].anchorId
    const nextEnd = newList[hi].anchorId
    if (nextStart === a.start && nextEnd === a.end) {
      kept.push(a)
      continue
    }

    // 范围缩了或挪了：连原文一起按新位置重新取一遍，保证卡片上显示的文字是准的
    const text = getRangeText(newContent, newList, nextStart, nextEnd)
    kept.push({ ...a, start: nextStart, end: nextEnd, text })
    changed = true
  }

  // 第二遍：已经是孤儿的，如果原文里又出现了（比如把删掉的词打回去了），
  // 就重新挂上；否则原样留着，继续当孤儿。
  for (const a of pendingRescue) {
    const found = locateAnnotation(newList, a, claimedWords)
    if (!found) {
      kept.push(a)
      continue
    }

    if (found.start === found.end) {
      claimedWords.add(found.start)
      kept.push({ ...a, start: found.start, end: found.end })
    } else {
      const text = getRangeText(newContent, newList, found.start, found.end)
      kept.push({ ...a, start: found.start, end: found.end, text })
    }
    changed = true
  }

  return { annotations: kept, newOrphans, changed }
}

/**
 * 拿标注存着的原文，在词表里找回它的位置。
 *
 * 单个词和一整段的找法不同，这是刻意保留旧行为：
 * - 单个词只比对词本身，所以正文里的 `she's` 能救回一条 `she` 的笔记
 * - 一整段连撇号一起比对，避免把 "I don't know" 错配到 "I do know"
 */
function locateAnnotation(
  list: WordRef[],
  annotation: Annotation,
  claimedWords: Set<string>
): { start: string; end: string } | null {
  // 存下来的原文也过一遍同一个分词器，两边口径才一致 ——
  // 否则原文里的数字、标点会让逐词比对错位
  const target = buildWordList(annotation.text)
  if (target.length === 0) return null

  if (target.length === 1) {
    const spelling = target[0].word.toLowerCase()
    const hit = list.find(
      (w) => !claimedWords.has(w.anchorId) && w.word.toLowerCase() === spelling
    )
    return hit ? { start: hit.anchorId, end: hit.anchorId } : null
  }

  const seq = target.map((w) => wordWithSuffix(w).toLowerCase())
  for (let i = 0; i + seq.length <= list.length; i++) {
    let hit = true
    for (let k = 0; k < seq.length; k++) {
      if (wordWithSuffix(list[i + k]).toLowerCase() !== seq[k]) {
        hit = false
        break
      }
    }
    if (hit) return { start: list[i].anchorId, end: list[i + seq.length - 1].anchorId }
  }
  return null
}

/** 用户对孤儿选择「保留」：位置置空，内容原样留着 */
export function markAnnotationOrphaned(a: Annotation): Annotation {
  return { ...a, start: null, end: null }
}
