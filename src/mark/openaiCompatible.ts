import { createChatCaller } from '../enrich/openaiCompatible'
import {
  DEFINITION_SPEC,
  LEMMA_SPEC,
  PHONETIC_SPEC,
  PHRASE_DEFINITION_SPEC,
  PHRASE_USAGE_SPEC,
  POS_SPEC
} from '../enrich/fieldSpecs'
import type { ResolvedProvider } from '../enrich'
import { collectPicks } from './parse'
import type { MarkLine, MarkOptions, Marker } from './types'

/**
 * 「一键划词」的 AI 实现。
 *
 * 和填充层共用同一套请求管道（createChatCaller）—— 同样的地址与认证、
 * 同样的 JSON 模式兜底、同样的错误话术，不重写一遍。
 */

/** 难度档给 AI 的说法。用「什么样的词算超纲」来描述，比甩一个考试名字管用 */
const LEVEL_HINT: Record<MarkOptions['level'], string> = {
  cet4: '大学英语四级水平。高中之后才接触的词就算，日常高频词（good、people、because）不算',
  cet6: '大学英语六级水平。四级范围内的词一律不挑，只挑更进一层的',
  kaoyan: '考研英语水平。六级范围内的词一律不挑，偏重学术与书面用词',
  ielts: '雅思 7 分水平。挑地道、书面、学术的表达，常见词一律不挑'
}

/** 一次划多少。给个数量区间，别让模型自由发挥 */
const AMOUNT_HINT: Record<MarkOptions['amount'], string> = {
  few: '只挑最值得记的，总共 15 到 20 条',
  medium: '总共 30 到 40 条',
  many: '凡是达到上述难度的都挑出来，不设上限'
}

export function buildSystemPrompt(options: MarkOptions): string {
  return `你是一个英语精读老师，为中文学习者从原文里挑出值得记的生词和短语。

用户会给你若干行原文，每行带一个行号（line）。请挑出其中值得记的**单词**和**短语/固定搭配**。

挑选标准：
- 难度：${LEVEL_HINT[options.level]}
- 数量：${AMOUNT_HINT[options.amount]}
- 同一个词在全文出现多次时，**只挑第一次出现的那一处**
- 人名、地名、纯数字不要挑

对每一条输出：
- line：它所在的行号，必须是用户给你的那些行号之一
- text：**原文里的确切写法**，一个字母都不能改
- kind："word" 或 "phrase"

kind 是 word 时给这几项（写法要求和「一键填充」完全一致）：
- phonetic：${PHONETIC_SPEC}
- pos：${POS_SPEC}
- definition：${DEFINITION_SPEC}
- lemma：${LEMMA_SPEC}

kind 是 phrase 时给这两项：
- definition：${PHRASE_DEFINITION_SPEC}
- usage：${PHRASE_USAGE_SPEC}

**关于 text 这一条要格外当心**：必须是原文里逐字符照抄的样子，不要还原成原形。
原文写的是 took off 就给 took off，不要给 take off；
原文写的是 stumbling 就给 stumbling，不要给 stumble。
照抄不了的宁可不挑 —— 对不上的条目会被丢弃。

只输出 JSON，形如：
{"picks":[{"line":12,"text":"stumbled","kind":"word","phonetic":"/ˈstʌmbld/","pos":"v.","definition":"绊倒；跌跌撞撞（stumble 过去式）","lemma":"stumble"},{"line":14,"text":"took off","kind":"phrase","definition":"脱下；起飞（take off 过去式）","usage":"后接衣物，或指飞机离地；take off 还有「事业腾飞」的引申义"}]}

不要输出任何解释文字。`
}

export function createOpenAICompatibleMarker(provider: ResolvedProvider): Marker {
  const call = createChatCaller(provider)

  return {
    name: provider.name,
    async pick(lines: MarkLine[], options, signal) {
      if (lines.length === 0) return []
      const payload = { lines: lines.map((l) => ({ line: l.line, text: l.text })) }
      const parsed = await call(buildSystemPrompt(options), payload, signal)
      return collectPicks(parsed)
    }
  }
}
