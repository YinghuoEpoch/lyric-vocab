/**
 * 「一键划词」的统一约定。
 *
 * 和导入层、填充层同一个思路：界面只认这份约定，具体谁来挑词都是可替换的实现。
 */

/** 难度档：只划到得上这个水平的词 */
export type MarkLevel = 'cet4' | 'cet6' | 'kaoyan' | 'ielts'

/** 一次划多少 */
export type MarkAmount = 'few' | 'medium' | 'many'

export interface MarkOptions {
  level: MarkLevel
  amount: MarkAmount
}

/** 送给 AI 的一行正文。行号就是正文里的真实行号，AI 要原样带回来 */
export interface MarkLine {
  line: number
  text: string
}

/**
 * AI 挑出来的一条。
 *
 * `text` 必须是**原文里的确切写法**（took off，不是 take off）——
 * 定位那一步就靠它在指定行里精确查找，对不上就跳过。
 */
export interface MarkPick {
  line: number
  text: string
  kind: 'word' | 'phrase'
  phonetic?: string
  pos?: string
  definition?: string
  /** 短语的用法 / 搭配 */
  usage?: string
}

export interface Marker {
  name: string
  /** 从这几行里挑词。返回的条目可能对不上原文，定位那一步会如实报数 */
  pick(lines: MarkLine[], options: MarkOptions, signal?: AbortSignal): Promise<MarkPick[]>
}
