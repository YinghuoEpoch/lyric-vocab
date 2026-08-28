import type { Enricher } from './types'
import { createDeepSeekEnricher } from './deepseek'

/**
 * 填充层入口。
 *
 * API Key 只存在这台手机的本地存储里，不会上传到任何地方，
 * 也不会跟着「导出备份」走 —— 备份文件可能被分享出去。
 */

const API_KEY_STORAGE = 'lyric-vocab-ai-key'

export function getApiKey(): string {
  try {
    return localStorage.getItem(API_KEY_STORAGE) ?? ''
  } catch {
    return ''
  }
}

export function setApiKey(key: string): void {
  try {
    const trimmed = key.trim()
    if (trimmed) localStorage.setItem(API_KEY_STORAGE, trimmed)
    else localStorage.removeItem(API_KEY_STORAGE)
  } catch {
    // 存不下就算了，这次会话内仍可使用
  }
}

export function hasApiKey(): boolean {
  return getApiKey().length > 0
}

/** 按当前配置创建填充器；没有 key 时返回 null */
export function createEnricher(): Enricher | null {
  const key = getApiKey()
  return key ? createDeepSeekEnricher(key) : null
}

export * from './types'
export * from './runner'
