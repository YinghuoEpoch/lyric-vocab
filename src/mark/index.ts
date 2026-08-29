import { loadConfig, resolveConfig, type AiConfig } from '../enrich'
import { createOpenAICompatibleMarker } from './openaiCompatible'
import type { Marker } from './types'

/**
 * 「一键划词」入口。
 *
 * 界面只跟这里打交道。用哪家 AI、地址是什么，全都沿用「一键填充」那份配置
 * （enrich/config）—— 对用户来说本来就是同一个 Key、同一个服务，
 * 没道理让人配两遍。
 */

/** 按当前配置创建划词器；配置不全（缺 Key / 地址 / 模型）时返回 null */
export function createMarker(config: AiConfig = loadConfig()): Marker | null {
  const resolved = resolveConfig(config)
  return resolved ? createOpenAICompatibleMarker(resolved) : null
}

export * from './types'
export * from './locate'
export * from './runner'
export { collectPicks } from './parse'
