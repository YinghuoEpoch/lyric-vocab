import type { MarkPick } from './types'

/**
 * 把模型返回的 JSON 收成一批 pick。
 *
 * 模型返回的东西什么样都有 —— 少字段、类型不对、行号给成字符串、
 * 整个数组包在别的键里。这一层只管挡住：**认不出的条目直接丢掉，绝不抛错**，
 * 因为一条格式不对不该让整批白跑。丢了多少条，上层会如实报数。
 */

/** 行号可能是数字，也可能是 "12" 这样的字符串 */
function toLine(value: unknown): number | null {
  if (typeof value === 'number' && Number.isInteger(value) && value >= 0) return value
  if (typeof value === 'string') {
    const n = Number(value.trim())
    if (Number.isInteger(n) && n >= 0) return n
  }
  return null
}

function toText(value: unknown): string | undefined {
  if (typeof value !== 'string') return undefined
  const trimmed = value.trim()
  return trimmed || undefined
}

export function collectPicks(parsed: unknown): MarkPick[] {
  // 正常是 { picks: [...] }；有的模型直接给数组，也认
  const raw = parsed as { picks?: unknown } | unknown[]
  const list = Array.isArray(raw) ? raw : Array.isArray(raw?.picks) ? raw.picks : null
  if (!list) return []

  const out: MarkPick[] = []
  for (const row of list) {
    if (!row || typeof row !== 'object') continue
    const r = row as Record<string, unknown>

    const line = toLine(r.line)
    const text = toText(r.text)
    // 没有行号或没有原文的条目定位不了，留着也是白留
    if (line === null || !text) continue

    const pick: MarkPick = {
      line,
      text,
      // kind 只是个初值：真正算数的是定位时它实际占了几个词
      kind: r.kind === 'phrase' ? 'phrase' : 'word'
    }
    const phonetic = toText(r.phonetic)
    const pos = toText(r.pos)
    const definition = toText(r.definition)
    const usage = toText(r.usage)
    if (phonetic) pick.phonetic = phonetic
    if (pos) pick.pos = pos
    if (definition) pick.definition = definition
    if (usage) pick.usage = usage

    out.push(pick)
  }
  return out
}
