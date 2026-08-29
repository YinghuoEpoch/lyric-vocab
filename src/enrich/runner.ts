import type {
  Enricher,
  WordTask,
  SentenceTask,
  PhraseTask,
  WordFill,
  SentenceFill,
  PhraseFill
} from './types'

/**
 * 分批执行填充，边填边回报进度。
 *
 * 三条要求决定了这里的写法：
 * - **分批**：一次请求打包多条，逐条发会贵十几倍还慢
 * - **可中断**：手机上随时可能想停，或者切走了
 * - **边填边存**：中途断了已经填好的要留下，不能白跑
 *   所以每批完成就把结果交给上层写库，而不是全部跑完再一次性写
 */

/** 每批多少条。句子输出更长，批次小一些，免得单次响应过大被截断。 */
export const WORD_BATCH_SIZE = 40
export const SENTENCE_BATCH_SIZE = 15
/** 短语的输出比单词长、比句子短，批次取中间 */
export const PHRASE_BATCH_SIZE = 25

export interface FillProgress {
  /** 已处理条数（含没填上的） */
  done: number
  /** 总条数 */
  total: number
  /** 实际成功填上的条数 */
  filled: number
}

export interface RunOptions<Task, Fill> {
  tasks: Task[]
  batchSize: number
  /** 处理一批 */
  run: (batch: Task[], signal?: AbortSignal) => Promise<Record<string, Fill>>
  /** 每批完成后立即交给上层落库，中途中断也不会白跑 */
  onBatch: (results: Record<string, Fill>) => void | Promise<void>
  onProgress?: (p: FillProgress) => void
  signal?: AbortSignal
}

export function chunk<T>(items: T[], size: number): T[][] {
  const out: T[][] = []
  for (let i = 0; i < items.length; i += size) out.push(items.slice(i, i + size))
  return out
}

/**
 * 跑完一整批任务。
 * 中断时抛出 AbortError；此前每一批的结果都已经通过 onBatch 交出去了。
 */
export async function runBatches<Task, Fill>({
  tasks,
  batchSize,
  run,
  onBatch,
  onProgress,
  signal
}: RunOptions<Task, Fill>): Promise<FillProgress> {
  const progress: FillProgress = { done: 0, total: tasks.length, filled: 0 }
  onProgress?.({ ...progress })

  for (const batch of chunk(tasks, batchSize)) {
    if (signal?.aborted) throw new DOMException('已取消', 'AbortError')

    const results = await run(batch, signal)
    await onBatch(results)

    progress.done += batch.length
    progress.filled += Object.keys(results).length
    onProgress?.({ ...progress })
  }

  return progress
}

/**
 * 「还差什么」的判定与合并。
 *
 * 从前的规矩是「三格全空才算待填充」，代价是**写了一半的卡片没人管**：
 * 句摘写了句型没写翻译，既不计数也填不上，只能手工补。
 * 现在改成「**缺哪格补哪格**」—— 有一格空着就算待填充，填充时只往空格里写。
 *
 * 「绝不覆盖用户写过的内容」这条底线收在 mergeWordFill / mergeSentenceFill 里，
 * 只此一处；别处不要再各自判一遍，那种重复迟早会走样。
 */

type WordNoteFields = { phonetic?: string; pos?: string; definition?: string; lemma?: string }
type SentenceFields = { grammar?: string; meaning?: string }

const blank = (v?: string): boolean => !v?.trim()

/** 一条单词笔记还有格子空着吗（音标 / 词性 / 释义） */
export function isWordNoteIncomplete(note: WordNoteFields): boolean {
  return blank(note.phonetic) || blank(note.pos) || blank(note.definition)
}

/** 一条短语还有格子空着吗（释义 / 用法） */
export function isPhraseIncomplete(p: { definition?: string; grammar?: string }): boolean {
  return blank(p.definition) || blank(p.grammar)
}

/** 短语：把 AI 给的内容并进空格，用户写过的一律不动 */
export function mergePhraseFill(
  current: { definition?: string; grammar?: string },
  fill: PhraseFill
): Partial<PhraseFill> | null {
  const patch: Partial<PhraseFill> = {}
  let any = false
  for (const field of ['definition', 'grammar'] as const) {
    if (!blank(current[field])) continue
    const value = fill[field]
    if (blank(value)) continue
    patch[field] = value!.trim()
    any = true
  }
  return any ? patch : null
}

/** 一条句摘还有格子空着吗（句型说明 / 翻译） */
export function isSentenceIncomplete(s: SentenceFields): boolean {
  return blank(s.grammar) || blank(s.meaning)
}

/**
 * 单词：把 AI 给的内容并进空格，返回要写回去的那几项；没有可补的返回 null。
 *
 * lemma（原形）不在「格子」之列 —— 它不显示在卡片上，不该左右「填没填全」的判断，
 * 但既然模型顺带给了，空着就补上。
 */
export function mergeWordFill(note: WordNoteFields, fill: WordFill): Partial<WordFill> | null {
  const patch: Partial<WordFill> = {}
  let any = false
  for (const field of ['phonetic', 'pos', 'definition', 'lemma'] as const) {
    if (!blank(note[field])) continue // 用户写过的，一个字都不动
    const value = fill[field]
    if (blank(value)) continue
    patch[field] = value!.trim()
    any = true
  }
  return any ? patch : null
}

/** 句摘：同上 */
export function mergeSentenceFill(
  s: SentenceFields,
  fill: SentenceFill
): Partial<SentenceFill> | null {
  const patch: Partial<SentenceFill> = {}
  let any = false
  for (const field of ['grammar', 'meaning'] as const) {
    if (!blank(s[field])) continue
    const value = fill[field]
    if (blank(value)) continue
    patch[field] = value!.trim()
    any = true
  }
  return any ? patch : null
}

export interface FillWordsArgs {
  enricher: Enricher
  tasks: WordTask[]
  onBatch: (results: Record<string, WordFill>) => void | Promise<void>
  onProgress?: (p: FillProgress) => void
  signal?: AbortSignal
}

export function fillWords({ enricher, tasks, onBatch, onProgress, signal }: FillWordsArgs) {
  return runBatches<WordTask, WordFill>({
    tasks,
    batchSize: WORD_BATCH_SIZE,
    run: (batch, sig) => enricher.fillWords(batch, sig),
    onBatch,
    onProgress,
    signal
  })
}

export interface FillSentencesArgs {
  enricher: Enricher
  tasks: SentenceTask[]
  onBatch: (results: Record<string, SentenceFill>) => void | Promise<void>
  onProgress?: (p: FillProgress) => void
  signal?: AbortSignal
}

export function fillSentences({
  enricher,
  tasks,
  onBatch,
  onProgress,
  signal
}: FillSentencesArgs) {
  return runBatches<SentenceTask, SentenceFill>({
    tasks,
    batchSize: SENTENCE_BATCH_SIZE,
    run: (batch, sig) => enricher.fillSentences(batch, sig),
    onBatch,
    onProgress,
    signal
  })
}

export interface FillPhrasesArgs {
  enricher: Enricher
  tasks: PhraseTask[]
  onBatch: (results: Record<string, PhraseFill>) => void | Promise<void>
  onProgress?: (p: FillProgress) => void
  signal?: AbortSignal
}

export function fillPhrases({ enricher, tasks, onBatch, onProgress, signal }: FillPhrasesArgs) {
  return runBatches<PhraseTask, PhraseFill>({
    tasks,
    batchSize: PHRASE_BATCH_SIZE,
    run: (batch, sig) => enricher.fillPhrases(batch, sig),
    onBatch,
    onProgress,
    signal
  })
}
