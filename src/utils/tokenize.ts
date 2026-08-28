/**
 * 判断字符是否为“单词内”字符：拉丁字母（含重音）、撇号、连字符
 * 用于将 merry-go-round、well-known、puis-je、don't、mère 等识别为完整单词
 * 说明：
 * - [a-zA-Z]          覆盖基础英文
 * - \u00C0-\u00FF     覆盖 Latin-1 补充区（法语/德语/西语等重音字母）
 * - '                 撇号（如 don't）
 * - -                 连字符（复合词，连字符放字符类末尾表示字面量）
 */
function isEnglishChar(c: string): boolean {
  return /[a-zA-Z\u00C0-\u00FF'-]/.test(c)
}

/**
 * 判断是否为 CJK 字符（中日韩）
 */
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
 * 将一行文本拆分为英文 / 中文 / 其它 片段
 */
export function tokenizeLine(line: string): Segment[] {
  if (!line) return []
  const segments: Segment[] = []
  let i = 0
  while (i < line.length) {
    const c = line[i]
    if (isEnglishChar(c)) {
      let end = i
      while (end < line.length && isEnglishChar(line[end])) end++
      segments.push({ type: 'en', text: line.slice(i, end) })
      i = end
    } else if (isCjkChar(c)) {
      let end = i
      while (end < line.length && isCjkChar(line[end])) end++
      segments.push({ type: 'zh', text: line.slice(i, end) })
      i = end
    } else {
      let end = i
      while (end < line.length && !isEnglishChar(line[end]) && !isCjkChar(line[end])) end++
      segments.push({ type: 'other', text: line.slice(i, end) })
      i = end
    }
  }
  return segments
}

/**
 * 从一行中提取所有英文单词（用于生成 anchor 索引）
 */
export function getEnglishWords(line: string): string[] {
  const segments = tokenizeLine(line)
  const words: string[] = []
  for (const seg of segments) {
    if (seg.type === 'en') {
      const w = seg.text.trim()
      if (w) words.push(w)
    }
  }
  return words
}
