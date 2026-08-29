import type { Enricher, WordFill, SentenceFill } from './types'
import { chatEndpoint, type ResolvedProvider } from './config'

/**
 * 「OpenAI 兼容」实现 —— 一份代码接所有家。
 *
 * DeepSeek、通义千问、智谱、Kimi、OpenAI 本身，以及本机跑的 Ollama / LM Studio，
 * 对外都是同一套接口：POST 到 `<地址>/chat/completions`，`Bearer` 认证，
 * 返回 `choices[0].message.content`。所以这里不需要引任何 SDK，也不需要一家写一遍，
 * 只把**地址**和**模型名**当参数传进来即可（见 config.ts）。
 *
 * 一次请求打包多条，不是一条一条发：逐条发的话每次都要重发一遍指令，
 * 会贵十几倍而且慢得多。
 */

const WORD_SYSTEM_PROMPT = `你是一个英语词典助手，为中文学习者标注生词。

用户会给你一组单词，每个词带一个 id，多数还带有它在原文中所在的那一行（context）。
请为每个词输出：
- phonetic：国际音标，两侧带斜杠，例如 /stʊd/。按该词在 context 中的实际读音标注。
- pos：词性缩写，用中文习惯写法，例如 n. / v. / adj. / adv. / prep. / conj.
- definition：中文释义，简洁。**必须结合 context 选择该处真正的含义**，
  不要罗列多个义项。例如 stood 在 "I never stood up very tall" 中是「站立」，
  而在 "the offer stood" 中是「仍然有效」。
  **如果这个词不是原形（是过去式、过去分词、现在分词、复数、比较级等变形），
  就在释义末尾用括号补上原形和变形类型**，例如：
  flying -> 飞行；飞翔（fly 现在分词）
  stood -> 站立；挺立（stand 过去式）
  children -> 孩子们（child 复数）
  本身就是原形的词不要加括号，直接给释义即可。
- lemma：该词的原形，例如 stood -> stand、bursting -> burst。本身就是原形则原样返回。

严格返回 JSON，形如：
{"results":[{"id":"...","phonetic":"...","pos":"...","definition":"...","lemma":"..."}]}
不要输出 JSON 以外的任何内容。每个传入的 id 都要有一条对应结果。`

const SENTENCE_SYSTEM_PROMPT = `你是一个英语语法老师，为中文学习者讲解句子。

用户会给你一组英文句子，每句带一个 id。请为每句输出：
- grammar：句型/语法说明。指出这句话用到的关键结构、时态、固定搭配或值得注意的用法，
  简洁但要具体，30 到 60 字。不要泛泛地说「这是一个陈述句」。
- meaning：中文翻译，通顺自然，不要逐字硬译。

严格返回 JSON，形如：
{"results":[{"id":"...","grammar":"...","meaning":"..."}]}
不要输出 JSON 以外的任何内容。每个传入的 id 都要有一条对应结果。`

interface ChatResponse {
  choices?: Array<{ message?: { content?: string } }>
  error?: { message?: string }
}

/**
 * 从模型返回的文本里取出 JSON。
 * 即使要求了 JSON 模式，也可能被 ```json 围栏包着，这里一并处理。
 */
export function extractJson(raw: string): unknown {
  const text = raw.trim()
  const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/i)
  const candidate = (fenced ? fenced[1] : text).trim()
  return JSON.parse(candidate)
}

/** 把模型返回的结果整理成 { id: 内容 }，顺带丢掉空字段与多余空白 */
export function collectResults<T extends Record<string, unknown>>(
  parsed: unknown,
  fields: Array<keyof T & string>
): Record<string, T> {
  const out: Record<string, T> = {}
  const list = (parsed as { results?: unknown })?.results
  if (!Array.isArray(list)) return out

  for (const row of list) {
    if (!row || typeof row !== 'object') continue
    const id = (row as Record<string, unknown>).id
    if (typeof id !== 'string' || !id) continue

    const item = {} as T
    let hasAny = false
    for (const field of fields) {
      const value = (row as Record<string, unknown>)[field]
      if (typeof value !== 'string') continue
      const trimmed = value.trim()
      if (!trimmed) continue
      ;(item as Record<string, string>)[field] = trimmed
      hasAny = true
    }
    if (hasAny) out[id] = item
  }
  return out
}

/**
 * 把 HTTP 错误翻成用户看得懂的一句话。
 *
 * 不写死某一家的说法（原来 402 直接说「DeepSeek 余额不足」），
 * 因为现在对面可能是任何一家；服务商自己的原文附在后面，真要排查时有据可查。
 */
export function describeHttpError(status: number, body: string, providerName: string): string {
  const detail = extractErrorMessage(body)
  const tail = detail ? `：${detail}` : ''
  if (status === 401 || status === 403) return `API Key 无效或没有权限，请检查后重新填写${tail}`
  if (status === 402) return `${providerName} 账户余额不足，请先充值${tail}`
  if (status === 404) return `地址或模型名不对（${status}），请检查「AI 设置」里的服务地址与模型${tail}`
  if (status === 429) return `请求太频繁或已达用量上限，请稍后再试${tail}`
  if (status >= 500) return `${providerName} 服务暂时不可用（${status}），请稍后再试${tail}`
  return `调用失败（${status}）${tail}`
}

/**
 * 从服务商返回的错误体里取出人能读的那句话。
 *
 * 各家出错时返回的是一整坨 JSON，原样贴到界面上又长又难看，
 * 还会在手机上被截断在半个词上。真正有用的只有里面的 message 一项。
 */
export function extractErrorMessage(body: string): string {
  const text = body.trim()
  if (!text) return ''
  try {
    const parsed = JSON.parse(text) as {
      error?: { message?: unknown }
      message?: unknown
    }
    const message = parsed.error?.message ?? parsed.message
    if (typeof message === 'string' && message.trim()) return message.trim().slice(0, 160)
  } catch {
    // 不是 JSON（有的网关直接返回 HTML 或纯文本），退回原样截断
  }
  return text.slice(0, 160)
}

/** 这个 400 是不是「不支持 JSON 模式」引起的 —— 是的话去掉那个参数重试一次 */
export function isJsonModeUnsupported(status: number, body: string): boolean {
  if (status !== 400 && status !== 422) return false
  return /response_format|json_object|json.mode/i.test(body)
}

/**
 * 网络层面的失败（断网、地址写错域名解析不了、被 CORS 挡住）在 fetch 这里
 * 直接抛 TypeError，信息是「Failed to fetch」之类，对用户毫无意义，翻译一下。
 */
function describeNetworkError(err: unknown, baseUrl: string): Error {
  if (err instanceof DOMException && err.name === 'AbortError') return err as unknown as Error
  const reason = err instanceof Error ? err.message : String(err)
  return new Error(`连不上 ${baseUrl}，请检查网络和服务地址（${reason}）`)
}

export function createOpenAICompatibleEnricher(provider: ResolvedProvider): Enricher {
  const { name, baseUrl, model, apiKey } = provider
  const url = chatEndpoint(baseUrl)
  /** 试过一次发现对面不支持 JSON 模式，后面几批就不用再试了 */
  let jsonMode = true

  async function call(
    systemPrompt: string,
    userPayload: unknown,
    signal?: AbortSignal
  ): Promise<unknown> {
    const send = async (useJsonMode: boolean) => {
      const body: Record<string, unknown> = {
        model,
        messages: [
          { role: 'system', content: systemPrompt },
          { role: 'user', content: JSON.stringify(userPayload) }
        ],
        temperature: 0.3
      }
      if (useJsonMode) body.response_format = { type: 'json_object' }

      try {
        return await fetch(url, {
          method: 'POST',
          signal,
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${apiKey}`
          },
          body: JSON.stringify(body)
        })
      } catch (err) {
        throw describeNetworkError(err, baseUrl)
      }
    }

    let res = await send(jsonMode)

    if (!res.ok) {
      let detail = await res.text().catch(() => '')
      // 有的服务不认 response_format，去掉重来一次；系统提示里本来就要求了只输出 JSON
      if (jsonMode && isJsonModeUnsupported(res.status, detail)) {
        jsonMode = false
        res = await send(false)
        if (!res.ok) detail = await res.text().catch(() => '')
      }
      if (!res.ok) throw new Error(describeHttpError(res.status, detail, name))
    }

    const data = (await res.json()) as ChatResponse
    if (data.error?.message) throw new Error(data.error.message)

    const content = data.choices?.[0]?.message?.content
    if (!content) throw new Error('模型没有返回内容')

    try {
      return extractJson(content)
    } catch {
      throw new Error('模型返回的内容不是有效的 JSON，可能是模型名填错了或该模型不擅长按格式输出')
    }
  }

  return {
    name,

    async fillWords(tasks, signal) {
      if (tasks.length === 0) return {}
      const payload = {
        words: tasks.map((t) => ({ id: t.id, word: t.word, context: t.context ?? '' }))
      }
      const parsed = await call(WORD_SYSTEM_PROMPT, payload, signal)
      return collectResults<WordFill & Record<string, unknown>>(parsed, [
        'phonetic',
        'pos',
        'definition',
        'lemma'
      ])
    },

    async fillSentences(tasks, signal) {
      if (tasks.length === 0) return {}
      const payload = { sentences: tasks.map((t) => ({ id: t.id, text: t.text })) }
      const parsed = await call(SENTENCE_SYSTEM_PROMPT, payload, signal)
      return collectResults<SentenceFill & Record<string, unknown>>(parsed, ['grammar', 'meaning'])
    }
  }
}

/**
 * 「测试连接」：拿一个词跑一次真实的填充。
 *
 * 不另外造一个轻量请求，是因为要验的正是「这个地址 + 这个模型 + 这个 Key
 * 能不能按我们要的格式返回」—— 用真实路径试才作数。
 */
export async function testProvider(provider: ResolvedProvider): Promise<string> {
  const enricher = createOpenAICompatibleEnricher(provider)
  const result = await enricher.fillWords([{ id: 'test', word: 'stood', context: 'He stood up.' }])
  const fill = result.test
  if (!fill?.definition) throw new Error('连上了，但模型没有按要求返回内容，换个模型试试')
  return fill.definition
}
