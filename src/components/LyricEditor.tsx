import { memo, useState, useCallback, useRef, useLayoutEffect, useEffect, useMemo } from 'react'
import { tokenizeLine } from '../utils/tokenize'
import type { NotesMap, ReaderSettings, Sentence, WordNote } from '../types'
import { X, Trash2 } from 'lucide-react'
import { useWordInteraction } from '../hooks/useWordInteraction'
import { useBackHandler, BackPriority } from '../hooks/useBackHandler'
import { buildWordList, getRangeText as sliceRangeText } from '../utils/reconcile'

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
  /** 切换编辑模式；退出时把最终正文一并交出去，供上层做笔记对账 */
  onEditModeChange: (v: boolean, finalContent?: string) => void
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

function LyricEditorInner({
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

  /**
   * 文档顺序下的所有英文词（用于句摘范围与高亮）。
   * 编号规则与「对账」共用同一份实现，避免两边算出来的坐标对不上。
   */
  const orderedWords = useMemo(() => buildWordList(content), [content])

  const getRangeText = useCallback(
    (startAnchorId: string, endAnchorId: string) =>
      sliceRangeText(content, orderedWords, startAnchorId, endAnchorId),
    [content, orderedWords]
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
    // 取整到百分点：进度条本来也只显示到这个精度，
    // 而滚动每帧都触发，不取整的话每一帧都是一个新数值，白白引发整树重渲染
    const percent = Math.round(Math.min(100, Math.max(0, (scrollTop / maxScroll) * 100)))
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

  /**
   * 编辑模式下的正文草稿。
   *
   * textarea 显示什么由 React 控制。原来它直接绑 content，而 content 要等异步保存
   * 走完一圈才更新 —— 在这一圈走完之前，React 认为「数据没变、你的输入不算数」，
   * 于是把 textarea 的内容改回旧文本；而重新写入内容会让浏览器把光标顶到末尾。
   *
   * 这里用一份「敲一下就立刻更新」的本地草稿：React 当场就看到新内容，
   * 不会去纠正它，光标自然留在原地。保存仍然照常异步进行。
   */
  const [draft, setDraft] = useState(content)

  // 进入编辑模式、或切换到另一篇文档时，用最新正文重置草稿。
  // 故意不跟着 content 变化重置：编辑过程中 content 会被自己的输入不断更新，
  // 跟着它走又会把光标顶到末尾，等于没修。
  useEffect(() => {
    if (editMode) setDraft(content)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [editMode, pageId])

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

  // 安卓返回键：先收起抽屉，保留选区；再按一次才清掉选区。
  // 和「点空白处」的行为保持一致。
  useBackHandler(!!fullMode || !!selection, BackPriority.wordDrawer, () => {
    if (fullMode) setFullMode(null)
    else clearAll()
  })

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
      // 同理：已标记「原文已删除」的句摘不再在正文里画虚线范围
      if (s.orphaned) continue
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
            onClick={() => onEditModeChange(false, draft)}
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
            value={draft}
            onChange={(e) => {
              // 先同步更新草稿（光标不被顶走），再照常触发异步保存
              setDraft(e.target.value)
              onContentChange?.(e.target.value)
            }}
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
              // 孤儿笔记不画线：它的坐标已经失效，画出来就是给错误的词加下划线
              const hasNote = !!notes[anchorId] && !notes[anchorId].orphaned
              const inSentenceRange = sentenceRangeAnchorSet.has(anchorId)
              const isPressing = pressingAnchorId === anchorId
              // 单个词被选中时也要持续高亮。原来只有句摘范围有底色，
              // 选中一个词时按压高亮又已经消失，抽屉弹出来后完全看不出选的是哪个词。
              const isSelectedWord = selection?.type === 'word' && selection.anchorId === anchorId

              // 三种底色互斥，收成一个类名，免得多个 bg-* 叠在一起靠优先级打架：
              // 按住中 > 当前选中的词 > 处于句摘范围内
              const highlightClass = isPressing
                ? 'bg-amber-300/70'
                : isSelectedWord
                  ? 'bg-amber-200/80'
                  : inSentenceRange
                    ? 'bg-amber-100/70'
                    : ''

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
                  className={`cursor-pointer rounded px-0.5 -mx-0.5 transition-colors select-none touch-manipulation ${highlightClass} ${
                    hasNote ? 'underline decoration-amber-600 decoration-2 underline-offset-2' : ''
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
          {/*
            抽屉是「浮在正文之上的一层」，但**不能加遮罩** ——
            开着抽屉时还要能点正文里的下一个词把选区连成句子，遮罩会把这条路挡死。
            所以分离感全靠自己：一条上边框 + 一片向上的投影。

            顶部从前有一条装饰用的小横杠，它在暗示「可以往下拖关闭」，
            可抽屉根本拖不动 —— 与其留一个骗人的手势提示，不如去掉。
          */}
          <div
            data-full-popup="true"
            className="fixed z-20 bg-white border-t border-paper-border p-4 left-0 right-0 bottom-0 w-full rounded-t-2xl max-h-[70vh] overflow-y-auto"
            style={{
              paddingBottom: 'max(env(safe-area-inset-bottom), 16px)',
              boxShadow: '0 -10px 28px -12px rgba(44, 44, 44, 0.22)'
            }}
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-start justify-between gap-3 mb-3">
              <span className="font-lyric-en font-serif text-amber-800 font-bold text-lg leading-snug min-w-0 break-words">
                {selection.type === 'word' ? selection.word : selection.text}
              </span>
              <button
                type="button"
                onClick={closeFullPopup}
                className="shrink-0 -mr-1 -mt-1 w-9 h-9 flex items-center justify-center rounded-lg hover:bg-stone-100 text-ink-muted"
                aria-label="关闭"
              >
                <X className="w-4 h-4" />
              </button>
            </div>
            {fullMode === 'word' ? (
              /* 音标要装 /ˈbɜːrstɪŋ/，词性只要装 v. adj. —— 从前两者平分宽度，是错的 */
              <div className="grid grid-cols-3 gap-2 mb-4">
                <input
                  type="text"
                  placeholder="音标"
                  aria-label="音标"
                  className="field-sheet col-span-2 font-mono italic"
                  value={bubbleForm.phonetic ?? ''}
                  onChange={(e) => setBubbleForm((f) => ({ ...f, phonetic: e.target.value }))}
                />
                <input
                  type="text"
                  placeholder="词性"
                  aria-label="词性"
                  className="field-sheet text-center"
                  value={bubbleForm.pos ?? ''}
                  onChange={(e) => setBubbleForm((f) => ({ ...f, pos: e.target.value }))}
                />
                <input
                  type="text"
                  placeholder="中文释义"
                  aria-label="中文释义"
                  className="field-sheet col-span-3"
                  value={bubbleForm.definition ?? ''}
                  onChange={(e) => setBubbleForm((f) => ({ ...f, definition: e.target.value }))}
                />
              </div>
            ) : (
              <div className="grid grid-cols-1 gap-2 mb-4">
                <input
                  type="text"
                  placeholder="句型 / 语法"
                  aria-label="句型语法"
                  className="field-sheet"
                  value={sentenceForm.grammar}
                  onChange={(e) => setSentenceForm((f) => ({ ...f, grammar: e.target.value }))}
                />
                <input
                  type="text"
                  placeholder="翻译 / 释义"
                  aria-label="翻译释义"
                  className="field-sheet"
                  value={sentenceForm.meaning}
                  onChange={(e) => setSentenceForm((f) => ({ ...f, meaning: e.target.value }))}
                />
              </div>
            )}
            {/* 保存是主操作，给到 44px；删除退成次要样式，不跟主按钮抢眼 */}
            <div className="flex gap-2">
              <button
                type="button"
                onClick={saveBubble}
                className="flex-1 h-11 rounded-lg bg-amber-600 hover:bg-amber-700 active:bg-amber-800 text-white font-medium text-[15px] transition-colors"
              >
                保存
              </button>
              {selection.type === 'word' && notes[selection.anchorId] && (
                <button
                  type="button"
                  onClick={deleteMark}
                  className="h-11 px-4 rounded-lg bg-stone-100 hover:bg-red-50 text-red-600 font-medium text-[15px] flex items-center gap-1.5 transition-colors"
                  title="删除标记"
                >
                  <Trash2 className="w-4 h-4" />
                  删除
                </button>
              )}
              {canDeleteSentence && (
                <button
                  type="button"
                  onClick={handleDeleteSentence}
                  className="h-11 px-4 rounded-lg bg-stone-100 hover:bg-red-50 text-red-600 font-medium text-[15px] flex items-center gap-1.5 transition-colors"
                  title="删除句摘"
                >
                  <Trash2 className="w-4 h-4" />
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

/**
 * 用 memo 包一层：阅读时每一帧滚动都会更新最外层的阅读进度状态，
 * 不隔离的话整棵树（含上千个单词节点）每帧重渲染一次，这正是滚动卡顿的来源。
 * props 没变就跳过渲染。
 */
export const LyricEditor = memo(LyricEditorInner)
