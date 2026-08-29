import { describe, it, expect, vi, afterEach } from 'vitest'
import {
  createOpenAICompatibleEnricher,
  describeHttpError,
  isJsonModeUnsupported
} from './openaiCompatible'
import type { ResolvedProvider } from './config'

/**
 * 「OpenAI 兼容」实现的测试。
 *
 * 这块的风险在于：一份代码要接不同家的服务，各家总有点小脾气 ——
 * 有的不认「强制 JSON 输出」这个参数，有的错误码含义不一样。
 * 不能因为换了一家就整个填充功能报个看不懂的错。
 */

const provider: ResolvedProvider = {
  name: '自定义',
  baseUrl: 'https://example.com/v1',
  model: 'some-model',
  apiKey: 'sk-test'
}

/** 造一个够用的假响应；只用到 ok / status / text / json 四样 */
function reply(status: number, body: unknown) {
  const text = typeof body === 'string' ? body : JSON.stringify(body)
  return {
    ok: status >= 200 && status < 300,
    status,
    text: async () => text,
    json: async () => JSON.parse(text)
  }
}

/** 模型正常返回一条结果 */
function modelSaid(results: unknown) {
  return reply(200, { choices: [{ message: { content: JSON.stringify({ results }) } }] })
}

function bodyOf(call: unknown[]): Record<string, unknown> {
  return JSON.parse((call[1] as { body: string }).body)
}

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('发出去的请求', () => {
  it('地址、认证与模型名都按配置来', async () => {
    const fetchMock = vi.fn(async () =>
      modelSaid([{ id: 'a', definition: '站立', phonetic: '/stʊd/' }])
    )
    vi.stubGlobal('fetch', fetchMock)

    const result = await createOpenAICompatibleEnricher(provider).fillWords([
      { id: 'a', word: 'stood', context: 'He stood up.' }
    ])

    const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit]
    expect(url).toBe('https://example.com/v1/chat/completions')
    expect((init.headers as Record<string, string>).Authorization).toBe('Bearer sk-test')
    expect(bodyOf(fetchMock.mock.calls[0] as unknown[]).model).toBe('some-model')
    expect(result).toEqual({ a: { definition: '站立', phonetic: '/stʊd/' } })
  })

  it('没有任务时一次请求都不发', async () => {
    const fetchMock = vi.fn()
    vi.stubGlobal('fetch', fetchMock)
    await createOpenAICompatibleEnricher(provider).fillWords([])
    expect(fetchMock).not.toHaveBeenCalled()
  })
})

describe('对面不支持「强制 JSON 输出」', () => {
  it('去掉那个参数重试一次，用户看不出发生过什么', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(reply(400, { error: { message: 'response_format is not supported' } }))
      .mockResolvedValueOnce(modelSaid([{ id: 'a', definition: '站立' }]))
    vi.stubGlobal('fetch', fetchMock)

    const result = await createOpenAICompatibleEnricher(provider).fillWords([
      { id: 'a', word: 'stood' }
    ])

    expect(fetchMock).toHaveBeenCalledTimes(2)
    expect(bodyOf(fetchMock.mock.calls[0] as unknown[]).response_format).toBeDefined()
    expect(bodyOf(fetchMock.mock.calls[1] as unknown[]).response_format).toBeUndefined()
    expect(result).toEqual({ a: { definition: '站立' } })
  })

  it('记住这件事，后面几批不再白试一次', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(reply(400, 'response_format not supported'))
      .mockResolvedValue(modelSaid([{ id: 'a', definition: '站立' }]))
    vi.stubGlobal('fetch', fetchMock)

    const enricher = createOpenAICompatibleEnricher(provider)
    await enricher.fillWords([{ id: 'a', word: 'stood' }])
    await enricher.fillWords([{ id: 'a', word: 'stood' }])

    // 第一批试了两次，第二批直接用不带参数的那一种
    expect(fetchMock).toHaveBeenCalledTimes(3)
    expect(bodyOf(fetchMock.mock.calls[2] as unknown[]).response_format).toBeUndefined()
  })

  it('别的 400 不做这个重试，如实报错', async () => {
    const fetchMock = vi.fn(async () => reply(400, 'model not found'))
    vi.stubGlobal('fetch', fetchMock)

    await expect(
      createOpenAICompatibleEnricher(provider).fillWords([{ id: 'a', word: 'stood' }])
    ).rejects.toThrow(/400/)
    expect(fetchMock).toHaveBeenCalledTimes(1)
  })
})

describe('错误说人话', () => {
  it('认证失败说 Key，不说 401', () => {
    expect(describeHttpError(401, '', '自定义')).toMatch(/API Key/)
  })

  it('余额不足带上是哪一家（原来写死了 DeepSeek）', () => {
    expect(describeHttpError(402, '', '自定义')).toMatch(/^自定义 账户余额不足/)
  })

  it('404 指向「地址或模型名不对」—— 自定义供应商最常见的错', () => {
    expect(describeHttpError(404, '', '自定义')).toMatch(/服务地址与模型/)
  })

  it('服务商自己的原文附在后面，排查时有据可查', () => {
    expect(describeHttpError(500, 'upstream timeout', '自定义')).toMatch(/upstream timeout/)
  })

  it('只有提到 response_format 的 400 才算「不支持 JSON 模式」', () => {
    expect(isJsonModeUnsupported(400, 'invalid response_format')).toBe(true)
    expect(isJsonModeUnsupported(400, 'model not found')).toBe(false)
    expect(isJsonModeUnsupported(401, 'response_format')).toBe(false)
  })

  it('连不上时给出地址，而不是一句 Failed to fetch', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => {
        throw new TypeError('Failed to fetch')
      })
    )
    await expect(
      createOpenAICompatibleEnricher(provider).fillWords([{ id: 'a', word: 'stood' }])
    ).rejects.toThrow(/连不上 https:\/\/example.com\/v1/)
  })

  it('模型答非所问时说清是格式问题，不是网络问题', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => reply(200, { choices: [{ message: { content: '好的，没问题！' } }] }))
    )
    await expect(
      createOpenAICompatibleEnricher(provider).fillWords([{ id: 'a', word: 'stood' }])
    ).rejects.toThrow(/不是有效的 JSON/)
  })
})
