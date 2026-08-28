import type { Enricher, WordTask, SentenceTask, WordFill, SentenceFill } from './types'

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

/** 一条单词笔记是否还是空白的（没有音标、词性、释义） */
export function isWordNoteEmpty(note: {
  phonetic?: string
  pos?: string
  definition?: string
}): boolean {
  return !note.phonetic?.trim() && !note.pos?.trim() && !note.definition?.trim()
}

/** 一条句摘是否还是空白的（没有句型说明、也没有翻译） */
export function isSentenceEmpty(s: { grammar?: string; meaning?: string }): boolean {
  return !s.grammar?.trim() && !s.meaning?.trim()
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
