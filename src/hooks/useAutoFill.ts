import { useCallback, useMemo, useRef, useState } from 'react'
import type { AppData, NotesMap, Sentence } from '../types'
import { buildWordList } from '../utils/reconcile'
import { getAppData } from '../storage'
import {
  createEnricher,
  fillWords,
  fillSentences,
  isWordNoteEmpty,
  isSentenceEmpty,
  type FillProgress,
  type WordTask,
  type SentenceTask
} from '../enrich'
import type { AutoFillState } from '../components/AutoFillDialog'

/**
 * 「一键填充」的组织者。
 *
 * 负责：从当前复习范围里挑出空白笔记 -> 交给填充层跑 -> 把结果写回去。
 * 具体谁来填、怎么分批，分别在 enrich/ 下面，这里只管串起来。
 */

type ReviewTarget = { type: 'page'; id: string } | { type: 'book'; id: string } | null

/** 单词任务的 id 直接用「文档 + 坐标」，回填时据此找回原处 */
const wordTaskId = (pageId: string, anchorId: string) => `${pageId}::${anchorId}`
const parseWordTaskId = (id: string): [string, string] => {
  const i = id.indexOf('::')
  return [id.slice(0, i), id.slice(i + 2)]
}

export interface UseAutoFillArgs {
  appData: AppData
  sentences: Sentence[]
  reviewTarget: ReviewTarget
  /** 整体替换某篇文档的笔记 */
  writeNotes: (pageId: string, notes: NotesMap) => Promise<void>
  setSentences: React.Dispatch<React.SetStateAction<Sentence[]>>
}

export function useAutoFill({
  appData,
  sentences,
  reviewTarget,
  writeNotes,
  setSentences
}: UseAutoFillArgs) {
  const [open, setOpen] = useState(false)
  const [state, setState] = useState<AutoFillState>({
    phase: 'idle',
    progress: { done: 0, total: 0, filled: 0 }
  })
  const abortRef = useRef<AbortController | null>(null)

  /** 当前复习范围覆盖哪些文档 */
  const scopePageIds = useMemo(() => {
    if (!reviewTarget) return []
    const alive = appData.pages.filter((p) => !p.deletedAt)
    if (reviewTarget.type === 'page') return alive.filter((p) => p.id === reviewTarget.id).map((p) => p.id)
    return alive.filter((p) => p.bookId === reviewTarget.id).map((p) => p.id)
  }, [reviewTarget, appData.pages])

  const scopeName = useMemo(() => {
    if (!reviewTarget) return ''
    if (reviewTarget.type === 'page') {
      return appData.pages.find((p) => p.id === reviewTarget.id)?.title || '未命名'
    }
    return appData.books.find((b) => b.id === reviewTarget.id)?.name || '未命名文库'
  }, [reviewTarget, appData.pages, appData.books])

  /** 范围内所有还是空白的单词笔记，附上它所在那一行作为上下文 */
  const wordTasks = useMemo<WordTask[]>(() => {
    const tasks: WordTask[] = []
    for (const pageId of scopePageIds) {
      const map = appData.notes[pageId]
      if (!map) continue
      const page = appData.pages.find((p) => p.id === pageId)
      const lines = page?.content ? page.content.split(/\r?\n/) : []
      const words = page?.content ? buildWordList(page.content) : []

      for (const [anchorId, note] of Object.entries(map)) {
        if (!note?.word || !isWordNoteEmpty(note)) continue
        const ref = words.find((w) => w.anchorId === anchorId)
        tasks.push({
          id: wordTaskId(pageId, anchorId),
          word: note.word,
          context: ref ? lines[ref.line] : undefined
        })
      }
    }
    return tasks
  }, [scopePageIds, appData.notes, appData.pages])

  const sentenceTasks = useMemo<SentenceTask[]>(() => {
    const inScope = new Set(scopePageIds)
    return sentences
      .filter((s) => inScope.has(s.docId) && s.text.trim() && isSentenceEmpty(s))
      .map((s) => ({ id: s.id, text: s.text }))
  }, [scopePageIds, sentences])

  const openDialog = useCallback(() => {
    setState({ phase: 'idle', progress: { done: 0, total: 0, filled: 0 } })
    setOpen(true)
  }, [])

  const closeDialog = useCallback(() => {
    abortRef.current?.abort()
    abortRef.current = null
    setOpen(false)
  }, [])

  const cancel = useCallback(() => {
    abortRef.current?.abort()
  }, [])

  const start = useCallback(() => {
    const enricher = createEnricher()
    if (!enricher) {
      setState((s) => ({ ...s, phase: 'error', message: '还没有填写 API Key' }))
      return
    }

    const controller = new AbortController()
    abortRef.current = controller
    const total = wordTasks.length + sentenceTasks.length
    let wordsFilled = 0

    setState({ phase: 'running', progress: { done: 0, total, filled: 0 } })

    void (async () => {
      try {
        // 单词：按文档分组回写，一批一批地存，中途停了已填的也留得住
        const wordResult = await fillWords({
          enricher,
          tasks: wordTasks,
          signal: controller.signal,
          onProgress: (p: FillProgress) =>
            setState({ phase: 'running', progress: { done: p.done, total, filled: p.filled } }),
          onBatch: async (results) => {
            const byPage = new Map<string, Record<string, (typeof results)[string]>>()
            for (const [taskId, fill] of Object.entries(results)) {
              const [pageId, anchorId] = parseWordTaskId(taskId)
              const bucket = byPage.get(pageId) ?? {}
              bucket[anchorId] = fill
              byPage.set(pageId, bucket)
            }

            for (const [pageId, fills] of byPage) {
              // 必须重新读一遍：writeNotes 是整篇替换，
              // 用创建这个闭包时的旧数据去拼，会把前几批已经填好的内容冲掉
              const latest = await getAppData()
              const current = latest.notes[pageId] ?? {}
              const next: NotesMap = { ...current }
              for (const [anchorId, fill] of Object.entries(fills)) {
                const note = current[anchorId]
                // 期间用户可能自己写了内容，那就不要覆盖
                if (!note || !isWordNoteEmpty(note)) continue
                next[anchorId] = { ...note, ...fill, auto: true }
              }
              await writeNotes(pageId, next)
            }
          }
        })
        wordsFilled = wordResult.filled

        await fillSentences({
          enricher,
          tasks: sentenceTasks,
          signal: controller.signal,
          onProgress: (p: FillProgress) =>
            setState({
              phase: 'running',
              progress: {
                done: wordTasks.length + p.done,
                total,
                filled: wordsFilled + p.filled
              }
            }),
          onBatch: (results) => {
            setSentences((prev) =>
              prev.map((s) => {
                const fill = results[s.id]
                if (!fill || !isSentenceEmpty(s)) return s
                return { ...s, ...fill, auto: true, date: Date.now() }
              })
            )
          }
        })

        setState((s) => ({ ...s, phase: 'done' }))
      } catch (e) {
        const aborted = e instanceof DOMException && e.name === 'AbortError'
        setState((s) => ({
          ...s,
          phase: aborted ? 'done' : 'error',
          message: aborted
            ? '已停止，此前填好的内容都保留了。'
            : e instanceof Error
              ? e.message
              : String(e)
        }))
      } finally {
        abortRef.current = null
      }
    })()
  }, [wordTasks, sentenceTasks, writeNotes, setSentences])

  return {
    open,
    state,
    scopeName,
    emptyWords: wordTasks.length,
    emptySentences: sentenceTasks.length,
    openDialog,
    closeDialog,
    start,
    cancel
  }
}
