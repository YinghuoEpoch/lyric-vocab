import type { MarkAmount, MarkLevel, MarkOptions } from './types'

/**
 * 记住上次选的难度档与数量。
 *
 * 存在本机 localStorage，不进数据库、也不跟着备份走 ——
 * 它只是个顺手的默认值，换台手机重新选一次没什么损失。
 */

const KEY = 'lyric-vocab-mark-options'

const LEVELS: MarkLevel[] = ['cet4', 'cet6', 'kaoyan', 'ielts']
const AMOUNTS: MarkAmount[] = ['few', 'medium', 'many']

export const DEFAULT_MARK_OPTIONS: MarkOptions = { level: 'cet4', amount: 'few' }

export const LEVEL_LABEL: Record<MarkLevel, string> = {
  cet4: '四级',
  cet6: '六级',
  kaoyan: '考研',
  ielts: '雅思'
}

export const AMOUNT_LABEL: Record<MarkAmount, string> = {
  few: '精挑',
  medium: '适中',
  many: '尽量多'
}

export const AMOUNT_HINT: Record<MarkAmount, string> = {
  few: '约 15–20 条',
  medium: '约 30–40 条',
  many: '不设上限'
}

/**
 * 解析存下来的那串东西。
 *
 * 单独抽成纯函数才好测 —— 认不出的一律退回默认档：
 * 存的东西坏了不该让这个功能整个用不了。
 */
export function parseStoredMarkOptions(raw: string | null): MarkOptions {
  if (!raw) return DEFAULT_MARK_OPTIONS
  try {
    const parsed = JSON.parse(raw) as Partial<MarkOptions>
    return {
      level: LEVELS.includes(parsed?.level as MarkLevel)
        ? (parsed.level as MarkLevel)
        : DEFAULT_MARK_OPTIONS.level,
      amount: AMOUNTS.includes(parsed?.amount as MarkAmount)
        ? (parsed.amount as MarkAmount)
        : DEFAULT_MARK_OPTIONS.amount
    }
  } catch {
    return DEFAULT_MARK_OPTIONS
  }
}

export function loadMarkOptions(): MarkOptions {
  try {
    return parseStoredMarkOptions(localStorage.getItem(KEY))
  } catch {
    return DEFAULT_MARK_OPTIONS
  }
}

export function saveMarkOptions(options: MarkOptions): void {
  try {
    localStorage.setItem(KEY, JSON.stringify(options))
  } catch {
    // 存不下就算了，下次重新选一遍而已
  }
}
