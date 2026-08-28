import { useState, useCallback, useRef, useLayoutEffect, useEffect, useMemo } from 'react'
import { tokenizeLine } from '../utils/tokenize'
import type { NotesMap, ReaderSettings, Sentence, WordNote } from '../types'
import { X, Trash2 } from 'lucide-react'
import { useWordInteraction } from '../hooks/useWordInteraction'

const PROGRESS_DEBOUNCE_MS = 700

/** 单词选择：仅一个词 */
type WordSelection = { type: 'word'; anchorId: string; word: string }
/** 句摘选择：从 start 到 end 的连续词范围（按文档顺序） */
type SentenceSelection = { type: 'sentence'; startAnchorId: string; endAnchorId: string; text: string }
type Selection = WordSelection | SentenceSelection

interface LyricEditorProps {
  content: string
  pageId: string
  notes: NotesMap
  /** 当前文档下已保存的句摘（用于在原文中持久标记句子范围） */
  sentences?: Sentence[]
  onContentChange?: (content: string) => void
  onNoteSave: (anchorId: string, note: WordNote) => void
  onNoteDelete: (anchorId: string) => void
  /** 保存句摘（Phase 2） */
  onAddSentence?: (sentence: {
    text: string
    grammar: string
    meaning: string
    docId: string
    startAnchorId: string
    endAnchorId: string
  }) => void
  /** 待编辑的句子（从右侧栏点击编辑按钮时传入） */
  pendingSentenceEdit?: Sentence | null
  /** 删除句摘 */
  onDeleteSentence?: (startAnchorId: string, endAnchorId: string) => void
  editMode: boolean
  onEditModeChange: (v: boolean) => void
  /** 上次保存的滚动位置，打开文档时恢复 */
  savedProgress?: number
  /** 滚动停止后回调，用于持久化进度 */
  onSaveProgress?: (scrollTop: number) => void
  /** 上一章（同文库/同组内上一篇） */
  prevPage?: { id: string; title: string } | null
  /** 下一章（同文库/同组内下一篇） */
  nextPage?: { id: string; title: string } | null
  /** 切换到指定文档（用于上一章/下一章） */
  onSelectPage?: (pageId: string) => void
  /** 当前文档阅读进度 0–100，供侧栏进度条显示 */
  onReadingProgressChange?: (percent: number) => void
  /** 阅读外观（字号、字体、主题） */
  readerSettings?: ReaderSettings
}

function getAnchorId(lineIndex: number, wordIndex: number): string {
  return `L${lineIndex}W${wordIndex}`
}

export function LyricEditor({
  content,
  pageId,
  notes,
  sentences,
  onContentChange,
  onNoteSave,
  onNoteDelete,
  onAddSentence,
  pendingSentenceEdit,
  onDeleteSentence,
  editMode,
  onEditModeChange,
  savedProgress = 0,
  onSaveProgress,
  nextPage,
  onSelectPage,
  onReadingProgressChange,
  readerSettings = { fontSize: 18, fontFamily: 'sans', theme: 'pure' }
}: LyricEditorProps) {
  const lines = content ? content.split(/\n/) : ['']

  /** 文档顺序下的所有英文词（用于句摘范围与高亮） */
  const orderedWords = useMemo(() => {
    const out: { anchorId: string; word: string }[] = []
    lines.forEach((line, lineIndex) => {
      const segments = tokenizeLine(line)
      let wordIndex = 0
      for (const seg of segments) {
        if (seg.type === 'en') {
          out.push({ anchorId: getAnchorId(lineIndex, wordIndex), word: seg.text })
          wordIndex++
        }
      }
    })
    return out
  }, [lines])

  const getRangeText = useCallback(
    (startAnchorId: string, endAnchorId: string) => {
      const i = orderedWords.findIndex((w) => w.anchorId === startAnchorId)
      const j = orderedWords.findIndex((w) => w.anchorId === endAnchorId)
      if (i === -1 || j === -1) return ''
      const [lo, hi] = i <= j ? [i, j] : [j, i]
      return orderedWords
        .slice(lo, hi + 1)
        .map((w) => w.word)
        .join(' ')
    },
    [orderedWords]
  )

  const normalizeRange = useCallback(
    (anchorA: string, anchorB: string): { startAnchorId: string; endAnchorId: string } => {
      const i = orderedWords.findIndex((w) => w.anchorId === anchorA)
      const j = orderedWords.findIndex((w) => w.anchorId === anchorB)
      if (i === -1 || j === -1) return { startAnchorId: anchorA, endAnchorId: anchorB }
      return i <= j
        ? { startAnchorId: anchorA, endAnchorId: anchorB }
        : { startAnchorId: anchorB, endAnchorId: anchorA }
    },
    [orderedWords]
  )

  const themeStyles =
    readerSettings.theme === 'original'
      ? { bg: 'bg-[#f8f9f8]', text: 'text-[#2c3e34]', border: 'border-[#2c3e34]/12' }
      : readerSettings.theme === 'rice'
        ? { bg: 'bg-[#fffefc]', text: 'text-[#333333]', border: 'border-amber-900/10' }
        : { bg: 'bg-white', text: 'text-gray-900', border: 'border-gray-200' }

  const fontStack =
    readerSettings.fontFamily === 'serif'
      ? "'Merriweather', 'Georgia', 'PingFang SC', 'Microsoft YaHei', 'SimHei', sans-serif"
      : readerSettings.fontFamily === 'rounded'
        ? "'Nunito', 'Quicksand', 'Arial Rounded MT Bold', 'PingFang SC', 'Microsoft YaHei', sans-serif"
        : "'Inter', '-apple-system', 'BlinkMacSystemFont', 'PingFang SC', 'Microsoft YaHei', sans-serif"
  const scrollContainerRef = useRef<HTMLDivElement>(null)
  const debounceTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  const reportProgress = useCallback(() => {
    const el = scrollContainerRef.current
    if (!el || !onReadingProgressChange) return
    const { scrollTop, scrollHeight, clientHeight } = el
    const maxScroll = Math.max(1, scrollHeight - clientHeight)
    const percent = Math.min(100, Math.max(0, (scrollTop / maxScroll) * 100))
    onReadingProgressChange(percent)
  }, [onReadingProgressChange])

  // 打开 / 切换文档时恢复滚动位置，在绘制前执行避免闪烁；随后上报一次阅读进度
  useLayoutEffect(() => {
    const el = scrollContainerRef.current
    if (!el || editMode) return
    const value = typeof savedProgress === 'number' && savedProgress > 0 ? savedProgress : 0
    el.scrollTop = value
    if (onReadingProgressChange) requestAnimationFrame(reportProgress)
  }, [pageId, editMode, onReadingProgressChange, reportProgress])

  const handleScroll = useCallback(() => {
    reportProgress()
    if (editMode || !onSaveProgress) return
    if (debounceTimerRef.current) clearTimeout(debounceTimerRef.current)
    debounceTimerRef.current = setTimeout(() => {
      debounceTimerRef.current = null
      const el = scrollContainerRef.current
      if (el) onSaveProgress(el.scrollTop)
    }, PROGRESS_DEBOUNCE_MS)
  }, [editMode, onSaveProgress, reportProgress])

  useEffect(() => {
    return () => {
      if (debounceTimerRef.current) clearTimeout(debounceTimerRef.current)
    }
  }, [])

  const [selection, setSelection] = useState<Selection | null>(null)
  const [bubbleForm, setBubbleForm] = useState<WordNote>({ word: '' })
  const [sentenceForm, setSentenceForm] = useState({ grammar: '', meaning: '' })
  // 底部抽屉当前模式：单词 or 句摘；null 表示不显示
  const [fullMode, setFullMode] = useState<'word' | 'sentence' | null>(null)

  // 当前选中的句子是否对应「已保存的句摘」：
  // - 第一次框选的新句子：不在 sentences 中 → 不显示删除按钮
  // - 从右侧句子卡片进入编辑（或已轻量保存过）：在 sentences 中 → 显示删除按钮
  const canDeleteSentence = useMemo(() => {
    if (!selection || selection.type !== 'sentence') return false
    if (!sentences || sentences.length === 0) return false
    return sentences.some(
      (s) =>
        s.docId === pageId &&
        s.startAnchorId === selection.startAnchorId &&
        s.endAnchorId === selection.endAnchorId
    )
  }, [selection, sentences, pageId])

  // 完全清空选择与抽屉
  const clearAll = useCallback(() => {
    setSelection(null)
    setFullMode(null)
  }, [])

  // 切换文档时，重置选择与弹窗状态
  useEffect(() => {
    clearAll()
  }, [pageId, clearAll])

  // 响应从右侧栏点击编辑按钮：打开句子编辑弹窗
  useEffect(() => {
    if (!pendingSentenceEdit || pendingSentenceEdit.docId !== pageId) return

    // 构建 SentenceSelection
    const text = getRangeText(pendingSentenceEdit.startAnchorId, pendingSentenceEdit.endAnchorId)
    setSelection({
      type: 'sentence',
      startAnchorId: pendingSentenceEdit.startAnchorId,
      endAnchorId: pendingSentenceEdit.endAnchorId,
      text
    })

    // 预填充表单
    setSentenceForm({
      grammar: pendingSentenceEdit.grammar || '',
      meaning: pendingSentenceEdit.meaning || ''
    })

    // 打开底部抽屉（句子模式）
    setFullMode('sentence')

    // 清空 pendingSentenceEdit，避免重复触发
    // 注意：这里不能直接调用 setPendingSentenceEdit，因为它是从 props 传入的
    // 需要在 App.tsx 中清空，但我们可以通过一个标记来避免重复处理
  }, [pendingSentenceEdit, pageId, getRangeText])

  const sentenceRangeAnchorSet = useMemo(() => {
    if (!selection || selection.type !== 'sentence') return new Set<string>()
    const i = orderedWords.findIndex((w) => w.anchorId === selection.startAnchorId)
    const j = orderedWords.findIndex((w) => w.anchorId === selection.endAnchorId)
    if (i === -1 || j === -1) return new Set<string>()
    const [lo, hi] = i <= j ? [i, j] : [j, i]
    const set = new Set<string>()
    for (let k = lo; k <= hi; k++) set.add(orderedWords[k].anchorId)
    return set
  }, [selection, orderedWords])

  // 已保存句摘的 anchor 集合：用于在原文中长期以虚线标记句子范围
  const savedSentenceAnchorSet = useMemo(() => {
    if (!sentences || sentences.length === 0) return new Set<string>()
    const set = new Set<string>()
    for (const s of sentences) {
      const i = orderedWords.findIndex((w) => w.anchorId === s.startAnchorId)
      const j = orderedWords.findIndex((w) => w.anchorId === s.endAnchorId)
      if (i === -1 || j === -1) continue
      const [lo, hi] = i <= j ? [i, j] : [j, i]
      for (let k = lo; k <= hi; k++) {
        set.add(orderedWords[k].anchorId)
      }
    }
    return set
  }, [sentences, orderedWords])

  /** 长按取词：支持「词 → 句摘 → 修正范围」，始终使用底部抽屉 */
  const openWordDrawer = useCallback(
    (anchorId: string, word: string) => {
      // 1. 当前没有选中：第一次长按，进入单词模式
      if (!selection) {
        const existing = notes[anchorId]
        setBubbleForm(
          existing
            ? { word: existing.word, phonetic: existing.phonetic, pos: existing.pos, definition: existing.definition }
            : { word }
        )
        setSelection({ type: 'word', anchorId, word })
        setFullMode('word') // 打开底部抽屉（音标 / 词性 / 释义）
        return
      }

      // 2. 已经选中一个单词
      if (selection.type === 'word') {
        // 再次长按同一个词：视为取消选中，关闭抽屉与高亮
        if (selection.anchorId === anchorId) {
          clearAll()
          return
        }
        // 长按另一个词：升级为句摘 A→B
        const { startAnchorId, endAnchorId } = normalizeRange(selection.anchorId, anchorId)
        const text = getRangeText(startAnchorId, endAnchorId)
        setSelection({ type: 'sentence', startAnchorId, endAnchorId, text })
        setSentenceForm({ grammar: '', meaning: '' })
        setFullMode('sentence') // 抽屉切换为句摘表单（句型 / 翻译）
        return
      }

      // 3. 已经是句摘模式：修正范围到新的终点
      if (selection.type === 'sentence') {
        const { startAnchorId, endAnchorId } = normalizeRange(selection.startAnchorId, anchorId)
        const text = getRangeText(startAnchorId, endAnchorId)
        setSelection({ type: 'sentence', startAnchorId, endAnchorId, text })
        setFullMode('sentence')
      }
    },
    [selection, notes, normalizeRange, getRangeText, clearAll]
  )

  /**
   * 已有选区时，轻点单词用于「连词成句 / 修正范围」：
   * - 当前为单词模式：点同一词 = 取消选中；点另一词 = 升级为句摘 A→B
   * - 当前为句摘模式：调整终点；若范围收缩为单个词，则退回单词模式
   */
  const adjustSelection = useCallback(
    (anchorId: string) => {
      if (!selection) return

      // 1. 当前为单词模式
      if (selection.type === 'word') {
        // 再次点击同一个已选中的单词：取消选中 + 收起抽屉
        if (anchorId === selection.anchorId) {
          clearAll()
          return
        }

        // 点击另一个单词：升级为句摘 A→B
        const { startAnchorId, endAnchorId } = normalizeRange(selection.anchorId, anchorId)
        const text = getRangeText(startAnchorId, endAnchorId)
        setSelection({ type: 'sentence', startAnchorId, endAnchorId, text })
        setSentenceForm({ grammar: '', meaning: '' })
        setFullMode('sentence')
        return
      }

      // 2. 当前为句摘模式：修正范围起止（保持起点 A 不变）
      if (selection.type === 'sentence') {
        const { startAnchorId, endAnchorId } = normalizeRange(selection.startAnchorId, anchorId)

        // 2.1 如果范围收缩为单个词，则退回单词模式
        if (startAnchorId === endAnchorId) {
          const single = orderedWords.find((w) => w.anchorId === startAnchorId)
          const wordText = single?.word ?? ''
          setSelection({ type: 'word', anchorId: startAnchorId, word: wordText })
          setFullMode('word')
          return
        }

        // 2.2 否则维持句摘模式
        const text = getRangeText(startAnchorId, endAnchorId)
        setSelection({ type: 'sentence', startAnchorId, endAnchorId, text })
        setFullMode('sentence')
      }
    },
    [selection, normalizeRange, getRangeText, orderedWords, clearAll]
  )

  const { getWordHandlers, pressingAnchorId, interactionHint } = useWordInteraction({
    onLongPress: openWordDrawer,
    onTapWithSelection: adjustSelection,
    hasSelection: !!selection
  })

  const saveBubble = useCallback(() => {
    if (!selection) return
    if (selection.type === 'word') {
      onNoteSave(selection.anchorId, { ...bubbleForm, word: selection.word })
    } else {
      onAddSentence?.({
        text: selection.text,
        grammar: sentenceForm.grammar,
        meaning: sentenceForm.meaning,
        docId: pageId,
        startAnchorId: selection.startAnchorId,
        endAnchorId: selection.endAnchorId
      })
    }
    // 大弹窗保存：完全结束这次操作（包括小气泡与选区）
    clearAll()
  }, [selection, bubbleForm, sentenceForm, pageId, onNoteSave, onAddSentence, clearAll])

  // 仅关闭大弹窗，不影响当前选中与小气泡
  const closeFullPopup = useCallback(() => {
    setFullMode(null)
  }, [])

  const deleteMark = useCallback(() => {
    if (!selection || selection.type !== 'word') return
    onNoteDelete(selection.anchorId)
    clearAll()
  }, [selection, onNoteDelete, clearAll])

  const handleDeleteSentence = useCallback(() => {
    if (!selection || selection.type !== 'sentence') return
    onDeleteSentence?.(selection.startAnchorId, selection.endAnchorId)
    clearAll()
  }, [selection, onDeleteSentence, clearAll])

  // 点在单词和抽屉之外时：
  // - 若抽屉开着：先收起抽屉，保留选中与高亮
  // - 若只剩选中：再点一次清除选中与高亮
  useEffect(() => {
    const handleGlobalClick = (event: MouseEvent) => {
      const target = event.target as HTMLElement | null
      if (!target) return

      // 点在英文词上：交给单词自己的长按 / 轻点逻辑，不清空
      if (target.closest('[data-word-span=\"true\"]')) return
      // 点在抽屉上：交给抽屉自身逻辑，不清空
      if (target.closest('[data-full-popup=\"true\"]')) return

      if (fullMode) {
        setFullMode(null)
      } else if (selection) {
        clearAll()
      }
    }

    window.addEventListener('click', handleGlobalClick)
    return () => {
      window.removeEventListener('click', handleGlobalClick)
    }
  }, [selection, fullMode, clearAll])

  if (editMode) {
    return (
      <div className="flex flex-col h-full overflow-hidden bg-white">
        <div className="shrink-0 flex items-center justify-between border-b border-gray-200 px-4 py-2 bg-white">
          <span className="text-sm opacity-80">编辑全文</span>
          <button
            type="button"
            onClick={() => onEditModeChange(false)}
            className="text-sm text-amber-500 hover:text-amber-400 font-medium"
          >
            完成
          </button>
        </div>
        <div
          className={`reader-scroll flex-1 min-h-0 overflow-y-auto scroll-area ${themeStyles.bg}`}
          style={{
            willChange: 'transform',
            transform: 'translateZ(0)',
            overscrollBehaviorY: 'contain',
            WebkitOverflowScrolling: 'touch'
          }}
        >
          <textarea
            className={`w-full min-h-full p-6 bg-transparent resize-none focus:outline-none block placeholder:opacity-60 antialiased ${themeStyles.text}`}
            style={{
              textRendering: 'optimizeSpeed',
              lineHeight: 1.8
            }}
            value={content}
            onChange={(e) => onContentChange?.(e.target.value)}
            placeholder="粘贴或输入中英混合文档内容..."
            spellCheck={false}
          />
        </div>
      </div>
    )
  }

  return (
    <div className="lyric-editor flex flex-col h-full overflow-hidden bg-white">
      <div className="shrink-0 flex items-center justify-between border-b border-gray-200 px-4 py-2 bg-white">
        <span className="text-sm opacity-80">{interactionHint}</span>
        <button
          type="button"
          onClick={() => onEditModeChange(true)}
          className="text-sm opacity-80 hover:opacity-100"
        >
          编辑全文
        </button>
      </div>
      <div
        ref={scrollContainerRef}
        onScroll={handleScroll}
        className={`reader-scroll flex-1 min-h-0 overflow-y-auto scroll-area touch-manipulation ${themeStyles.bg}`}
        style={{
          willChange: 'transform',
          transform: 'translateZ(0)',
          overscrollBehaviorY: 'contain',
          WebkitOverflowScrolling: 'touch'
        }}
      >
      <div
        className={`font-normal p-8 max-w-prose mx-auto antialiased ${themeStyles.text}`}
        style={{
          fontSize: readerSettings.fontSize,
          fontFamily: fontStack,
          textRendering: 'optimizeSpeed',
          lineHeight: 1.8
        }}
      >
        {lines.map((line, lineIndex) => {
          const segments = tokenizeLine(line)

          // 为当前行计算「已保存句摘」所覆盖的所有 segment（包括英文与中间的空格 / 标点）
          const savedSegmentMask: boolean[] = (() => {
            if (!sentences || !sentences.length || !savedSentenceAnchorSet.size) {
              return new Array(segments.length).fill(false)
            }
            const mask = new Array(segments.length).fill(false)
            let wordIndexForSaved = 0
            let clusterStart: number | null = null
            let clusterEnd: number | null = null

            for (let segIdx = 0; segIdx < segments.length; segIdx++) {
              const seg = segments[segIdx]
              if (seg.type === 'en') {
                const anchorIdForSeg = getAnchorId(lineIndex, wordIndexForSaved)
                const isSavedWord = savedSentenceAnchorSet.has(anchorIdForSeg)
                if (isSavedWord) {
                  if (clusterStart === null) {
                    clusterStart = segIdx
                  }
                  clusterEnd = segIdx
                } else if (clusterStart !== null && clusterEnd !== null) {
                  // 结束当前簇：将该簇内的所有 segment 标记为句摘范围
                  for (let k = clusterStart; k <= clusterEnd; k++) {
                    mask[k] = true
                  }
                  clusterStart = null
                  clusterEnd = null
                }
                wordIndexForSaved++
              }
            }
            // 行尾仍有未结束的簇
            if (clusterStart !== null && clusterEnd !== null) {
              for (let k = clusterStart; k <= clusterEnd; k++) {
                mask[k] = true
              }
            }
            return mask
          })()

          let wordIndex = 0

          // 渲染单个 segment，不负责句摘虚线（由外层块统一处理）
          const renderInnerSegment = (seg: (typeof segments)[number], segIdx: number) => {
            if (seg.type === 'en') {
              const word = seg.text
              const anchorId = getAnchorId(lineIndex, wordIndex)
              wordIndex++
              const hasNote = !!notes[anchorId]
              const inSentenceRange = sentenceRangeAnchorSet.has(anchorId)
              const isPressing = pressingAnchorId === anchorId
              const handlers = getWordHandlers(anchorId, word)
              return (
                <span
                  data-word-span="true"
                  key={segIdx}
                  id={anchorId}
                  role="button"
                  tabIndex={0}
                  // 手指按住时立刻变色，让用户知道「按住是有反应的、再等一下就成」；
                  // 触摸屏没有 hover，所以按压反馈是这里唯一的可点提示。
                  className={`cursor-pointer rounded px-0.5 -mx-0.5 transition-colors select-none touch-manipulation ${
                    isPressing ? 'bg-amber-300/70' : ''
                  } ${hasNote ? 'underline decoration-amber-600 decoration-2 underline-offset-2' : ''} ${
                    inSentenceRange ? 'bg-amber-100/70' : ''
                  }`}
                  {...handlers}
                >
                  {word}
                </span>
              )
            }
            if (seg.type === 'zh') {
              // 中文不参与句摘虚线展示，保持原样
              return (
                <span key={segIdx}>
                  {seg.text}
                </span>
              )
            }
            // 其它（空格 / 标点等）：保持原有样式，由外层块统一决定是否加虚线
            return (
              <span key={segIdx} className="text-ink-muted/80">
                {seg.text}
              </span>
            )
          }

          // 将一行拆分为若干块：在已保存句摘中的块 / 不在句摘中的块
          const lineChildren: React.ReactNode[] = []
          let segIdx = 0
          while (segIdx < segments.length) {
            const inSavedBlock = savedSegmentMask[segIdx]
            let end = segIdx + 1
            while (end < segments.length && savedSegmentMask[end] === inSavedBlock) {
              end++
            }

            const chunkElems: React.ReactNode[] = []
            for (let k = segIdx; k < end; k++) {
              chunkElems.push(renderInnerSegment(segments[k], k))
            }

            if (inSavedBlock) {
              // 整个块属于已保存句摘：统一在外层画一句连续的虚线
              lineChildren.push(
                <span
                  key={`chunk-${lineIndex}-${segIdx}`}
                  className="border-b border-dashed border-amber-600 pb-[1px]"
                >
                  {chunkElems}
                </span>
              )
            } else {
              // 普通块：直接输出内部内容
              lineChildren.push(
                <span key={`chunk-${lineIndex}-${segIdx}`}>{chunkElems}</span>
              )
            }

            segIdx = end
          }

          return (
            <p key={lineIndex} className="mb-6">
              {lineChildren}
            </p>
          )
        })}
        {/* 底部留白：固定高度，下一章链接放进此区域不额外占一行 */}
        <div className="h-32 flex flex-col justify-end">
          {nextPage && onSelectPage && (
            <div className="flex justify-end">
              <button
                type="button"
                onClick={() => onSelectPage(nextPage.id)}
                className="text-sm hover:underline underline-offset-2 transition-colors py-1 text-ink-muted hover:text-amber-700"
                aria-label={`下一章：${nextPage.title}`}
                title={nextPage.title}
              >
                下一章：<span className="truncate max-w-[200px] inline-block align-bottom">{nextPage.title}</span> →
              </button>
            </div>
          )}
        </div>
      </div>
      </div>

      {/* 底部抽屉：单词模式（音标、词性、释义）或句摘模式（句型、释义） */}
      {selection && fullMode && (
        <>
          <div
            data-full-popup="true"
            className="fixed z-20 bg-white shadow-xl p-3 left-0 right-0 bottom-0 w-full rounded-t-2xl max-h-[70vh] overflow-y-auto"
            style={{ paddingBottom: 'max(env(safe-area-inset-bottom), 16px)' }}
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex justify-center pt-2 pb-1">
              <div className="w-10 h-1 rounded-full bg-stone-200" aria-hidden />
            </div>
            <div className="flex items-center justify-between mb-2">
              <span className="font-lyric-en font-serif text-amber-800 font-semibold text-base truncate max-w-[220px]">
                {selection.type === 'word' ? selection.word : selection.text}
              </span>
              <button
                type="button"
                onClick={closeFullPopup}
                className="p-1 rounded hover:bg-stone-100 text-ink-muted shrink-0"
                aria-label="关闭"
              >
                <X className="w-3.5 h-3.5" />
              </button>
            </div>
            {fullMode === 'word' ? (
              <div className="grid grid-cols-2 gap-x-2 gap-y-2 mb-3">
                <input
                  type="text"
                  placeholder="音标"
                  className="h-8 px-2 py-1 text-sm rounded border border-paper-border bg-stone-50/80 text-ink placeholder-ink-muted focus:outline-none focus:ring-1 focus:ring-amber-500/40 focus:border-amber-500"
                  value={bubbleForm.phonetic ?? ''}
                  onChange={(e) => setBubbleForm((f) => ({ ...f, phonetic: e.target.value }))}
                />
                <input
                  type="text"
                  placeholder="词性"
                  className="h-8 px-2 py-1 text-sm rounded border border-paper-border bg-stone-50/80 text-ink placeholder-ink-muted focus:outline-none focus:ring-1 focus:ring-amber-500/40 focus:border-amber-500"
                  value={bubbleForm.pos ?? ''}
                  onChange={(e) => setBubbleForm((f) => ({ ...f, pos: e.target.value }))}
                />
                <input
                  type="text"
                  placeholder="中文释义"
                  className="col-span-2 h-8 px-2 py-1 text-sm rounded border border-paper-border bg-stone-50/80 text-ink placeholder-ink-muted focus:outline-none focus:ring-1 focus:ring-amber-500/40 focus:border-amber-500"
                  value={bubbleForm.definition ?? ''}
                  onChange={(e) => setBubbleForm((f) => ({ ...f, definition: e.target.value }))}
                />
              </div>
            ) : (
              <div className="grid grid-cols-1 gap-y-2 mb-3">
                <input
                  type="text"
                  placeholder="句型/语法"
                  className="h-8 px-2 py-1 text-sm rounded border border-paper-border bg-stone-50/80 text-ink placeholder-ink-muted focus:outline-none focus:ring-1 focus:ring-amber-500/40 focus:border-amber-500"
                  value={sentenceForm.grammar}
                  onChange={(e) => setSentenceForm((f) => ({ ...f, grammar: e.target.value }))}
                />
                <input
                  type="text"
                  placeholder="翻译/释义"
                  className="h-8 px-2 py-1 text-sm rounded border border-paper-border bg-stone-50/80 text-ink placeholder-ink-muted focus:outline-none focus:ring-1 focus:ring-amber-500/40 focus:border-amber-500"
                  value={sentenceForm.meaning}
                  onChange={(e) => setSentenceForm((f) => ({ ...f, meaning: e.target.value }))}
                />
              </div>
            )}
            <div className="flex gap-1.5">
              <button
                type="button"
                onClick={saveBubble}
                className="flex-1 h-8 rounded bg-amber-600 hover:bg-amber-700 text-white font-medium text-sm"
              >
                保存
              </button>
              {selection.type === 'word' && notes[selection.anchorId] && (
                <button
                  type="button"
                  onClick={deleteMark}
                  className="h-8 px-2 rounded border border-red-300 bg-white hover:bg-red-50 text-red-600 font-medium text-sm flex items-center gap-1"
                  title="删除标记"
                >
                  <Trash2 className="w-3.5 h-3.5" />
                  删除
                </button>
              )}
              {canDeleteSentence && (
                <button
                  type="button"
                  onClick={handleDeleteSentence}
                  className="h-8 px-2 rounded border border-red-300 bg-white hover:bg-red-50 text-red-600 font-medium text-sm flex items-center gap-1"
                  title="删除句摘"
                >
                  <Trash2 className="w-3.5 h-3.5" />
                  删除
                </button>
              )}
            </div>
          </div>
        </>
      )}
    </div>
  )
}
