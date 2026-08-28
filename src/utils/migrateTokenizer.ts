import { tokenizeLine } from './tokenize'
import type { NotesMap, Sentence } from '../types'

/**
 * 一次性数据迁移：切词规则变了，把笔记搬到新的词编号上。
 *
 * 背景：笔记挂在 anchorId（第几行第几个词）上。2026-08-29 修正了分词规则
 * （统一两种撇号、拆出缩写后缀、数字纳入单词、落单的连字符不再算词），
 * 于是同一段正文按新旧规则数出来的词序号会对不上 —— 正文一个字没变，
 * 但「数数的规矩」变了，所以平时那套「对账」在这里派不上用场。
 *
 * 做法：新旧两套规则扫的是同一串文字，因此可以按**字符位置**把
 * 「旧的第 N 个词」对应到「新的第几个词」。这是精确对应，不是猜。
 */

/** 旧规则下的词内字符判定。仅供迁移使用，不要在别处引用。 */
function isLegacyEnglishChar(c: string): boolean {
  return /[a-zA-ZÀ-ÿ'-]/.test(c)
}

function isLegacyCjkChar(c: string): boolean {
  const code = c.charCodeAt(0)
  return (
    (code >= 0x4e00 && code <= 0x9fff) ||
    (code >= 0x3400 && code <= 0x4dbf) ||
    (code >= 0x3000 && code <= 0x303f)
  )
}

interface Span {
  anchorId: string
  word: string
  line: number
  start: number
  end: number
}

/** 按旧规则列出全文的词及其字符位置 */
function legacySpans(content: string): Span[] {
  const out: Span[] = []
  const lines = content ? content.split(/\n/) : ['']

  lines.forEach((line, lineIndex) => {
    let wordIndex = 0
    let i = 0
    while (i < line.length) {
      const c = line[i]
      if (isLegacyEnglishChar(c)) {
        let end = i
        while (end < line.length && isLegacyEnglishChar(line[end])) end++
        const text = line.slice(i, end)
        if (text.trim()) {
          out.push({
            anchorId: `L${lineIndex}W${wordIndex}`,
            word: text,
            line: lineIndex,
            start: i,
            end
          })
          wordIndex++
        }
        i = end
      } else if (isLegacyCjkChar(c)) {
        while (i < line.length && isLegacyCjkChar(line[i])) i++
      } else {
        while (i < line.length && !isLegacyEnglishChar(line[i]) && !isLegacyCjkChar(line[i])) i++
      }
    }
  })

  return out
}

/** 按新规则列出全文的词及其字符位置 */
function currentSpans(content: string): Span[] {
  const out: Span[] = []
  const lines = content ? content.split(/\n/) : ['']

  lines.forEach((line, lineIndex) => {
    let wordIndex = 0
    let offset = 0
    for (const seg of tokenizeLine(line)) {
      if (seg.type === 'en') {
        out.push({
          anchorId: `L${lineIndex}W${wordIndex}`,
          word: seg.text,
          line: lineIndex,
          start: offset,
          end: offset + seg.text.length
        })
        wordIndex++
      }
      offset += seg.text.length
    }
  })

  return out
}

/**
 * 建立「旧 anchorId -> 新 anchorId」的对应表。
 *
 * 优先按字符区间重叠来配对（同一行、位置有交集）；若某个旧词在新规则下
 * 完全不再是单词（例如落单的连字符），则退而求其次挂到它前面最近的那个新词上，
 * 实在没有就放弃（该笔记会成为孤儿，走既有的「原文已删除」流程）。
 */
export function buildAnchorMigrationMap(content: string): Map<string, { anchorId: string; word: string }> {
  const olds = legacySpans(content)
  const news = currentSpans(content)
  const map = new Map<string, { anchorId: string; word: string }>()
  const taken = new Set<string>()

  const byLine = new Map<number, Span[]>()
  for (const n of news) {
    const list = byLine.get(n.line)
    if (list) list.push(n)
    else byLine.set(n.line, [n])
  }

  for (const o of olds) {
    const candidates = byLine.get(o.line) ?? []

    // 1) 位置有重叠的
    let hit = candidates.find((n) => n.start < o.end && n.end > o.start && !taken.has(n.anchorId))

    // 2) 没有重叠：挂到它前面最近的那个词上
    if (!hit) {
      for (const n of candidates) {
        if (n.end <= o.start && !taken.has(n.anchorId)) hit = n
      }
    }

    if (!hit) continue
    taken.add(hit.anchorId)
    map.set(o.anchorId, { anchorId: hit.anchorId, word: hit.word })
  }

  return map
}

export interface PageMigrationResult {
  notes: NotesMap
  sentences: Sentence[]
  /** 新旧规则下位置或文字有出入、确实需要写回的才为 true */
  changed: boolean
}

/**
 * 迁移一篇文档的笔记与句摘。
 * 找不到对应位置的笔记会被打上 orphaned 标记（走既有的「原文已删除」展示与删除入口），
 * 而不是悄悄丢掉。
 */
export function migratePage(
  content: string,
  notes: NotesMap,
  sentences: Sentence[]
): PageMigrationResult {
  const map = buildAnchorMigrationMap(content)
  let changed = false

  const nextNotes: NotesMap = {}
  for (const [anchorId, note] of Object.entries(notes)) {
    // 孤儿笔记本来就不挂在真实坐标上，原样保留
    if (note.orphaned) {
      nextNotes[anchorId] = note
      continue
    }

    const target = map.get(anchorId)
    if (!target) {
      nextNotes[anchorId] = { ...note, orphaned: true }
      changed = true
      continue
    }

    // 顺手把 word 刷新成新规则下的写法（COVID- -> COVID-19、s -> 1990s 之类）
    const nextNote = note.word === target.word ? note : { ...note, word: target.word }
    nextNotes[target.anchorId] = nextNote
    if (target.anchorId !== anchorId || nextNote !== note) changed = true
  }

  const nextSentences = sentences.map((s) => {
    if (s.orphaned) return s
    const start = map.get(s.startAnchorId)
    const end = map.get(s.endAnchorId)
    if (!start || !end) {
      changed = true
      return { ...s, orphaned: true }
    }
    if (start.anchorId === s.startAnchorId && end.anchorId === s.endAnchorId) return s
    changed = true
    return { ...s, startAnchorId: start.anchorId, endAnchorId: end.anchorId }
  })

  return { notes: nextNotes, sentences: nextSentences, changed }
}
