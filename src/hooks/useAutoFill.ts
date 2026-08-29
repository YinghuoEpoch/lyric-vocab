import { useCallback, useMemo, useRef, useState } from 'react'
import type { AppData, Annotation } from '../types'
import { buildWordList } from '../utils/reconcile'
import { getAppData } from '../storage'
import { annotationToSentence, annotationToWordNote } from '../utils/annotationViews'
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

/**
 * 任务 id 直接用标注自己的 id。
 *
 * 旧实现用的是「文档 + 坐标」拼出来的 id。可填充要跑好一阵子，期间用户完全可以
 * 去编辑正文 —— 坐标一变，回填就落到别的词上了。标注 id 不会变，这个隐患自然消失。
 */
export interface UseAutoFillArgs {
  appData: AppData
  reviewTarget: ReviewTarget
  /** 写回一条标注 */
  writeAnnotation: (annotation: Annotation) => Promise<void>
}

export function useAutoFill({ appData, reviewTarget, writeAnnotation }: UseAutoFillArgs) {
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

  const annotations = useMemo(() => appData.annotations ?? [], [appData.annotations])

  /** 范围内所有还是空白的单词笔记，附上它所在那一行作为上下文 */
  const wordTasks = useMemo<WordTask[]>(() => {
    const inScope = new Set(scopePageIds)
    const linesOf = new Map<string, string[]>()
    const wordsOf = new Map<string, ReturnType<typeof buildWordList>>()

    const tasks: WordTask[] = []
    for (const a of annotations) {
      if (a.type === 'sentence' || !inScope.has(a.docId)) continue
      if (!a.text || !isWordNoteEmpty(annotationToWordNote(a))) continue

      if (!linesOf.has(a.docId)) {
        const content = appData.pages.find((p) => p.id === a.docId)?.content ?? ''
        linesOf.set(a.docId, content ? content.split(/\r?\n/) : [])
        wordsOf.set(a.docId, content ? buildWordList(content) : [])
      }
      const ref = a.start ? wordsOf.get(a.docId)!.find((w) => w.anchorId === a.start) : undefined
      tasks.push({
        id: a.id,
        word: a.text,
        context: ref ? linesOf.get(a.docId)![ref.line] : undefined
      })
    }
    return tasks
  }, [scopePageIds, annotations, appData.pages])

  const sentenceTasks = useMemo<SentenceTask[]>(() => {
    const inScope = new Set(scopePageIds)
    return annotations
      .filter(
        (a) =>
          a.type === 'sentence' &&
          inScope.has(a.docId) &&
          a.text.trim() &&
          isSentenceEmpty(annotationToSentence(a))
      )
      .map((a) => ({ id: a.id, text: a.text }))
  }, [scopePageIds, annotations])

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
      setState((s) => ({ ...s, phase: 'error', message: '还没设好 AI —— 打开「AI 设置」填好 Key（自定义供应商还要填地址和模型名）' }))
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
            // 每批都重新读一遍：这中间用户可能改过东西，
            // 拿创建闭包时的旧数据去写会把人家的修改冲掉
            const latest = await getAppData()
            const byId = new Map((latest.annotations ?? []).map((a) => [a.id, a]))

            for (const [id, fill] of Object.entries(results)) {
              const target = byId.get(id)
              // 期间用户可能自己写了内容，或者把这条删了，那就跳过
              if (!target || !isWordNoteEmpty(annotationToWordNote(target))) continue
              await writeAnnotation({ ...target, ...fill, auto: true })
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
          onBatch: async (results) => {
            const latest = await getAppData()
            const byId = new Map((latest.annotations ?? []).map((a) => [a.id, a]))

            for (const [id, fill] of Object.entries(results)) {
              const target = byId.get(id)
              if (!target || !isSentenceEmpty(annotationToSentence(target))) continue
              await writeAnnotation({ ...target, ...fill, auto: true })
            }
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
  }, [wordTasks, sentenceTasks, writeAnnotation])

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
