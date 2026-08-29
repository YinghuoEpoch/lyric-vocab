import { describe, it, expect } from 'vitest'
import {
  chatEndpoint,
  defaultConfig,
  missingField,
  normalizeBaseUrl,
  parseStoredConfig,
  resolveConfig,
  type AiConfig
} from './config'

/**
 * 供应商配置的测试。
 *
 * 这块的风险有两处：一是用户手填的地址千奇百怪，规整不对就调不通还看不出为什么；
 * 二是从旧版本升上来的那条路 —— 老用户手机上只有一个裸的 Key，
 * 认不出来就等于把人家的 Key 弄丢了。
 */

describe('规整服务地址', () => {
  it('补上 https://', () => {
    expect(normalizeBaseUrl('api.deepseek.com/v1')).toBe('https://api.deepseek.com/v1')
  })

  it('http:// 原样保留（本机跑的服务用得上）', () => {
    expect(normalizeBaseUrl('http://localhost:11434/v1')).toBe('http://localhost:11434/v1')
  })

  it('去掉结尾多余的斜杠', () => {
    expect(normalizeBaseUrl('https://api.deepseek.com/v1//')).toBe('https://api.deepseek.com/v1')
  })

  it('用户把文档里的完整调用地址整个粘进来，也能认出基地址', () => {
    expect(normalizeBaseUrl('https://api.deepseek.com/v1/chat/completions')).toBe(
      'https://api.deepseek.com/v1'
    )
  })

  it('去掉尾巴上的查询串', () => {
    expect(normalizeBaseUrl('https://x.com/v1?key=1')).toBe('https://x.com/v1')
  })

  it('空的还是空的', () => {
    expect(normalizeBaseUrl('   ')).toBe('')
  })

  it('拼出实际调用地址', () => {
    expect(chatEndpoint('https://api.deepseek.com/v1')).toBe(
      'https://api.deepseek.com/v1/chat/completions'
    )
    // 粘的是完整地址也不会拼成两遍
    expect(chatEndpoint('https://api.deepseek.com/v1/chat/completions')).toBe(
      'https://api.deepseek.com/v1/chat/completions'
    )
  })
})

describe('读存下来的配置', () => {
  it('什么都没有就是一份默认配置', () => {
    expect(parseStoredConfig(null, null)).toEqual(defaultConfig())
  })

  it('旧版本只存了一个裸 Key，认成 DeepSeek 的', () => {
    const config = parseStoredConfig(null, 'sk-old')
    expect(config.providerId).toBe('deepseek')
    expect(config.keys.deepseek).toBe('sk-old')
  })

  it('新配置里已经有 DeepSeek 的 Key 时，旧 Key 不来捣乱', () => {
    const raw = JSON.stringify({ providerId: 'deepseek', keys: { deepseek: 'sk-new' } })
    expect(parseStoredConfig(raw, 'sk-old').keys.deepseek).toBe('sk-new')
  })

  it('各家的 Key 分开记，切来切去不用重填', () => {
    const raw = JSON.stringify({
      providerId: 'custom',
      baseUrl: 'https://api.moonshot.cn/v1',
      model: 'moonshot-v1-8k',
      keys: { deepseek: 'sk-a', custom: 'sk-b' }
    })
    const config = parseStoredConfig(raw, null)
    expect(config.keys).toEqual({ deepseek: 'sk-a', custom: 'sk-b' })
    expect(config.providerId).toBe('custom')
  })

  it('存坏了就当没有，不让整个填充功能挂掉', () => {
    expect(parseStoredConfig('{不是 JSON', null)).toEqual(defaultConfig())
  })

  it('认不出的供应商退回默认，不留个空壳', () => {
    const raw = JSON.stringify({ providerId: '某个未来版本才有的', keys: { deepseek: 'sk-a' } })
    expect(parseStoredConfig(raw, null).providerId).toBe('deepseek')
  })

  it('空白的 Key 不算数', () => {
    const raw = JSON.stringify({ providerId: 'deepseek', keys: { deepseek: '   ' } })
    expect(parseStoredConfig(raw, null).keys.deepseek).toBeUndefined()
  })
})

describe('解析成实际参数', () => {
  it('预设供应商：地址和模型来自预设，用户只需要给 Key', () => {
    const config: AiConfig = { ...defaultConfig(), keys: { deepseek: 'sk-a' } }
    expect(resolveConfig(config)).toEqual({
      name: 'DeepSeek',
      baseUrl: 'https://api.deepseek.com/v1',
      model: 'deepseek-chat',
      apiKey: 'sk-a'
    })
  })

  it('自定义供应商：地址和模型来自用户，并且顺手规整', () => {
    const config: AiConfig = {
      providerId: 'custom',
      baseUrl: 'api.moonshot.cn/v1/',
      model: ' moonshot-v1-8k ',
      keys: { custom: 'sk-b' }
    }
    expect(resolveConfig(config)).toEqual({
      name: '自定义',
      baseUrl: 'https://api.moonshot.cn/v1',
      model: 'moonshot-v1-8k',
      apiKey: 'sk-b'
    })
  })

  it('用的是自定义时，DeepSeek 那份 Key 不会被顶上来充数', () => {
    const config: AiConfig = {
      providerId: 'custom',
      baseUrl: 'https://api.moonshot.cn/v1',
      model: 'moonshot-v1-8k',
      keys: { deepseek: 'sk-a' }
    }
    expect(resolveConfig(config)).toBeNull()
    expect(missingField(config)).toBe('key')
  })

  it('缺哪一样就说哪一样', () => {
    expect(missingField(defaultConfig())).toBe('key')
    expect(missingField({ ...defaultConfig(), providerId: 'custom' })).toBe('baseUrl')
    expect(
      missingField({ providerId: 'custom', baseUrl: 'https://x.com/v1', model: '', keys: {} })
    ).toBe('model')
    expect(missingField({ ...defaultConfig(), keys: { deepseek: 'sk-a' } })).toBeNull()
  })
})
