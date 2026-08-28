/**
 * 分词：把一行文本切成 英文词 / 中文 / 其它 三类片段。
 *
 * 「一个词」的边界直接决定了笔记挂在哪儿（anchorId 是「第几行第几个词」），
 * 所以这里的规则改动会影响全库数据，改之前请先看 migrateTokenizer.ts。
 *
 * 规则概要：
 * - 字母（含重音字母）和数字算词内字符
 * - 撇号和连字符只有夹在词内字符「中间」时才算词内，落单的（如 students' 结尾的撇号、
 *   独立的破折号）不粘连
 * - 纯数字（2026、3-4）不算单词，避免正文里的年份章节号全都变成可标记的词
 * - 缩写后缀（she's 的 's、don't 的 n't）从词里拆出来当标点，
 *   这样长按能单独选中 she / do，而词的总数不变
 */

/** 两种撇号：直的 U+0027 和弯的 U+2019。网上复制来的文本大多是后者。 */
const APOSTROPHES = "'’"

/** 缩写后缀：撇号后面跟这些，就把这一截拆出去当标点 */
const CONTRACTION_SUFFIXES = new Set(['s', 'd', 'm', 't', 're', 've', 'll'])

/**
 * 不规则缩写：按 n't 规则拆会得到 ca / wo 这种垃圾，索性整体保留。
 * can't、won't 本身就是词典词条，整体选中反而更合用。
 */
const IRREGULAR_CONTRACTIONS = new Set(['cant', 'wont', 'shant'])

function isLetter(c: string): boolean {
  return /[a-zA-ZÀ-ÿ]/.test(c)
}

function isDigit(c: string): boolean {
  return c >= '0' && c <= '9'
}

/** 词内字符：字母或数字 */
function isWordChar(c: string): boolean {
  return isLetter(c) || isDigit(c)
}

/** 只有夹在词内字符中间时才算词内的连接符 */
function isConnector(c: string): boolean {
  return c === '-' || APOSTROPHES.includes(c)
}

/** 判断是否为 CJK 字符（中日韩） */
function isCjkChar(c: string): boolean {
  const code = c.charCodeAt(0)
  return (
    (code >= 0x4e00 && code <= 0x9fff) || // CJK 统一汉字
    (code >= 0x3400 && code <= 0x4dbf) ||
    (code >= 0x3000 && code <= 0x303f) // 标点等
  )
}

export type SegmentType = 'en' | 'zh' | 'other'

export interface Segment {
  type: SegmentType
  text: string
}

/**
 * 把一段「词串」按缩写规则拆成 [词, 后缀]。
 * 后缀为空字符串表示不拆。
 */
function splitContraction(run: string): [string, string] {
  const bare = run.replace(new RegExp(`[${APOSTROPHES}]`, 'g'), '').toLowerCase()
  if (IRREGULAR_CONTRACTIONS.has(bare)) return [run, '']

  const lower = run.toLowerCase()

  // don't -> do + n't（撇号在 n 后面，语义上的分界其实在 n 前面）
  for (const apo of APOSTROPHES) {
    const tail = `n${apo}t`
    if (lower.endsWith(tail) && run.length > tail.length) {
      return [run.slice(0, run.length - tail.length), run.slice(run.length - tail.length)]
    }
  }

  // she's -> she + 's
  let lastApo = -1
  for (let i = run.length - 1; i >= 0; i--) {
    if (APOSTROPHES.includes(run[i])) {
      lastApo = i
      break
    }
  }
  if (lastApo > 0) {
    const suffix = run.slice(lastApo + 1).toLowerCase()
    if (CONTRACTION_SUFFIXES.has(suffix)) {
      return [run.slice(0, lastApo), run.slice(lastApo)]
    }
  }

  return [run, '']
}

/**
 * 将一行文本拆分为英文 / 中文 / 其它 片段
 */
export function tokenizeLine(line: string): Segment[] {
  if (!line) return []
  const segments: Segment[] = []

  /** 把相邻的 other 合并，避免产生一堆碎片 */
  const pushOther = (text: string) => {
    if (!text) return
    const last = segments[segments.length - 1]
    if (last && last.type === 'other') last.text += text
    else segments.push({ type: 'other', text })
  }

  let i = 0
  while (i < line.length) {
    const c = line[i]

    if (isWordChar(c)) {
      // 扫出一整串「词串」：词内字符，以及夹在两个词内字符之间的连接符
      let end = i
      while (end < line.length) {
        if (isWordChar(line[end])) {
          end++
        } else if (isConnector(line[end]) && end + 1 < line.length && isWordChar(line[end + 1])) {
          end++
        } else {
          break
        }
      }

      const run = line.slice(i, end)
      i = end

      // 纯数字不算单词（年份、章节号之类，标出来只会是噪音）
      if (![...run].some(isLetter)) {
        pushOther(run)
        continue
      }

      const [word, suffix] = splitContraction(run)
      segments.push({ type: 'en', text: word })
      if (suffix) pushOther(suffix)
      continue
    }

    if (isCjkChar(c)) {
      let end = i
      while (end < line.length && isCjkChar(line[end])) end++
      segments.push({ type: 'zh', text: line.slice(i, end) })
      i = end
      continue
    }

    // 其它：标点、空格、落单的撇号与连字符
    let end = i
    while (end < line.length && !isWordChar(line[end]) && !isCjkChar(line[end])) end++
    pushOther(line.slice(i, end))
    i = end
  }

  return segments
}

/**
 * 从一行中提取所有英文单词（用于生成 anchor 索引）
 */
export function getEnglishWords(line: string): string[] {
  const words: string[] = []
  for (const seg of tokenizeLine(line)) {
    if (seg.type === 'en') {
      const w = seg.text.trim()
      if (w) words.push(w)
    }
  }
  return words
}
