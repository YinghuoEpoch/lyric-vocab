import { useCallback, useRef, useState } from 'react'
import type { Annotation } from '../types'
import { getAppData, generateId } from '../storage'
import { createMarker, runMark, type LocatedMark, type MarkOptions } from '../mark'
import type { AutoMarkState } from '../components/AutoMarkDialog'

/**
 * 「一键划词」的组织者。
 *
 * 负责：拿当前文档的正文 -> 交给划词层跑 -> 把定位好的结果建成标注。
 * 挑词、定位、分批分别在 mark/ 下面，这里只管串起来，外加一件它独有的事：
 * **记住这一批新建了哪些 id**，好让用户整批撤销。
 */

const emptyProgress = { done: 0, total: 0, marked: 0, missed: 0 }

/** 划完之后那条提示条要显示的内容 */
export interface MarkOutcome {
  marked: number
  missed: number
  /** 这一批新建的标注 id，撤销时按它删 */
  createdIds: string[]
  /** 属于哪篇文档 —— 换一篇就该消失 */
  docId: string
}

export interface UseAutoMarkArgs {
  /** 当前文档 */
  docId: string | null
  docName: string
  content: string
  /**
   * 把新划出来的一批写进去。
   *
   * 必须由上层给 —— 光调 storage 只把库写了，React 那份 appData 还是旧的，
   * 正文上一条线都不会出现（这个坑在浏览器里当场撞到过）。
   */
  writeAnnotations: (list: Annotation[]) => Promise<void>
}

export function useAutoMark({ docId, docName, content, writeAnnotations }: UseAutoMarkArgs) {
  const [open, setOpen] = useState(false)
  const [state, setState] = useState<AutoMarkState>({ phase: 'idle', progress: emptyProgress })
  const [outcome, setOutcome] = useState<MarkOutcome | null>(null)
  const abortRef = useRef<AbortController | null>(null)

  const openDialog = useCallback(() => {
    setState({ phase: 'idle', progress: emptyProgress })
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

  /** 换文档、或用户点了撤销之后，那条提示条就该消失 */
  const dismissOutcome = useCallback(() => setOutcome(null), [])

  const start = useCallback(
    (options: MarkOptions) => {
      if (!docId) return
      const marker = createMarker()
      if (!marker) {
        setState((s) => ({ ...s, phase: 'error', message: '还没设好 AI' }))
        return
      }

      const controller = new AbortController()
      abortRef.current = controller
      setState({ phase: 'running', progress: emptyProgress })
      setOutcome(null)

      void (async () => {
        const createdIds: string[] = []
        try {
          const latest = await getAppData()
          // 这一篇里已经标过的写法：AI 再挑到也不重复划（用户手标的也算数）
          const markedSpellings = new Set(
            (latest.annotations ?? [])
              .filter((a) => a.docId === docId && a.type !== 'sentence' && a.text)
              .map((a) => a.text.toLowerCase().replace(/['’]/g, ''))
          )

          const progress = await runMark({
            marker,
            content,
            options,
            markedSpellings,
            signal: controller.signal,
            onProgress: (p) => setState({ phase: 'running', progress: p }),
            onBatch: async (located: LocatedMark[]) => {
              if (located.length === 0) return
              const created: Annotation[] = []

              for (const m of located) {
                const a: Annotation = {
                  id: generateId(),
                  docId,
                  type: m.kind,
                  start: m.startAnchorId,
                  end: m.endAnchorId,
                  text: m.text,
                  createdAt: Date.now(),
                  // AI 划的一律带记号 —— 这本来就是一份待复核清单
                  auto: true
                }
                if (m.kind === 'word') {
                  if (m.pick.phonetic) a.phonetic = m.pick.phonetic
                  if (m.pick.pos) a.pos = m.pick.pos
                  if (m.pick.definition) a.definition = m.pick.definition
                  if (m.pick.lemma) a.lemma = m.pick.lemma
                } else {
                  if (m.pick.definition) a.definition = m.pick.definition
                  if (m.pick.usage) a.grammar = m.pick.usage
                }
                created.push(a)
                createdIds.push(a.id)
              }

              await writeAnnotations(created)
            }
          })

          setState({ phase: 'done', progress })
          setOutcome({
            marked: progress.marked,
            missed: progress.missed,
            createdIds,
            docId
          })
        } catch (e) {
          const aborted = e instanceof DOMException && e.name === 'AbortError'
          setState((s) => ({
            ...s,
            phase: aborted ? 'done' : 'error',
            message: aborted
              ? '已停止，此前划上的都保留了。'
              : e instanceof Error
                ? e.message
                : String(e)
          }))
          // 中途停掉也要能撤销 —— 已经划上的那几条同样是这一批的
          if (createdIds.length > 0) {
            setOutcome({
              marked: createdIds.length,
              missed: 0,
              createdIds,
              docId
            })
          }
        } finally {
          abortRef.current = null
        }
      })()
    },
    [docId, content, writeAnnotations]
  )

  return {
    open,
    state,
    outcome,
    docName,
    openDialog,
    closeDialog,
    start,
    cancel,
    dismissOutcome
  }
}
