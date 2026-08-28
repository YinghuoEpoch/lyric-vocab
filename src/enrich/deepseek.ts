import type { Enricher, WordFill, SentenceFill } from './types'

/**
 * DeepSeek 实现。
 *
 * 接口是 OpenAI 兼容格式，直接用 fetch 调即可，不需要引任何 SDK ——
 * 对手机 app 来说这样最轻。
 *
 * 一次请求打包多条，不是一条一条发：逐条发的话每次都要重发一遍指令，
 * 会贵十几倍而且慢得多。
 */

const API_URL = 'https://api.deepseek.com/chat/completions'
const MODEL = 'deepseek-chat'

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

async function callDeepSeek(
  apiKey: string,
  systemPrompt: string,
  userPayload: unknown,
  signal?: AbortSignal
): Promise<unknown> {
  const res = await fetch(API_URL, {
    method: 'POST',
    signal,
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${apiKey}`
    },
    body: JSON.stringify({
      model: MODEL,
      messages: [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: JSON.stringify(userPayload) }
      ],
      response_format: { type: 'json_object' },
      temperature: 0.3
    })
  })

  if (!res.ok) {
    const detail = await res.text().catch(() => '')
    if (res.status === 401) throw new Error('API Key 无效或已过期，请检查后重新填写')
    if (res.status === 402) throw new Error('DeepSeek 账户余额不足，请先充值')
    if (res.status === 429) throw new Error('请求太频繁，请稍后再试')
    throw new Error(`调用失败（${res.status}）${detail.slice(0, 120)}`)
  }

  const data = (await res.json()) as ChatResponse
  if (data.error?.message) throw new Error(data.error.message)

  const content = data.choices?.[0]?.message?.content
  if (!content) throw new Error('模型没有返回内容')

  try {
    return extractJson(content)
  } catch {
    throw new Error('模型返回的内容不是有效的 JSON')
  }
}

export function createDeepSeekEnricher(apiKey: string): Enricher {
  return {
    name: 'DeepSeek',

    async fillWords(tasks, signal) {
      if (tasks.length === 0) return {}
      const payload = {
        words: tasks.map((t) => ({ id: t.id, word: t.word, context: t.context ?? '' }))
      }
      const parsed = await callDeepSeek(apiKey, WORD_SYSTEM_PROMPT, payload, signal)
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
      const parsed = await callDeepSeek(apiKey, SENTENCE_SYSTEM_PROMPT, payload, signal)
      return collectResults<SentenceFill & Record<string, unknown>>(parsed, ['grammar', 'meaning'])
    }
  }
}
