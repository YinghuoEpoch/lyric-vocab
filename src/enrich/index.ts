import type { Enricher } from './types'
import { createOpenAICompatibleEnricher, testProvider } from './openaiCompatible'
import { loadConfig, resolveConfig, type AiConfig, type ResolvedProvider } from './config'

/**
 * 填充层入口。
 *
 * 界面只跟这里打交道：拿配置、存配置、要一个填充器。
 * 具体是哪家 AI、地址是什么，全在 config.ts 里，界面不需要知道。
 *
 * API Key 只存在这台手机的本地存储里，不会上传到任何地方，
 * 也不会跟着「导出备份」走 —— 备份文件可能被分享出去。
 */

/** 按当前配置创建填充器；配置不全（缺 Key / 地址 / 模型）时返回 null */
export function createEnricher(config: AiConfig = loadConfig()): Enricher | null {
  const resolved = resolveConfig(config)
  return resolved ? createOpenAICompatibleEnricher(resolved) : null
}

/** 试跑一次，确认这份配置真的能用。返回模型给出的一条释义，好让用户看出确实通了 */
export function testConfig(config: AiConfig): Promise<string> {
  const resolved = resolveConfig(config)
  if (!resolved) return Promise.reject(new Error('配置还不完整'))
  return testProvider(resolved)
}

export type { ResolvedProvider }
export * from './config'
export * from './types'
export * from './runner'
