import { memo, useState, useCallback, useRef, useLayoutEffect, useEffect, useMemo } from 'react'
import { useSpeak } from '../hooks/useSpeak'
import { tokenizeLine } from '../utils/tokenize'
import { splitEdgePunctuation, stripEdgePunctuation } from '../utils/punctuation'
import { BAND_SUB } from './chrome'
import { readerThemeStyles } from './theme'
import type { NotesMap, ReaderSettings, Sentence, WordNote } from '../types'
import type { PhraseView } from '../utils/annotationViews'
import { X, Trash2 } from 'lucide-react'
import { useWordInteraction } from '../hooks/useWordInteraction'
import { useBackHandler, BackPriority } from '../hooks/useBackHandler'
import { useIsWide } from '../hooks/useWideLayout'
import { useKeyboardHeight } from '../hooks/useKeyboardHeight'
import { buildWordList, getRangeText as sliceRangeText } from '../utils/reconcile'

const PROGRESS_DEBOUNCE_MS = 700

/** 宽屏上那个小弹窗有多宽，以及离屏幕边缘至少留多少 */
const POPUP_W = 320
const POPUP_MARGIN = 12
/** 再挤也不把小窗压得比这还矮，否则里面那几格没法填 */
const MIN_POPUP_H = 200

/**
 * 正文里三种标记的线。
 *
 * 位置一律从基线往下量、一律用 em（正文字号是用户可调的，用 px 的话
 * 调大字号线就贴到字上去了）。都别用 border-b：它落在「内容盒底部」，
 * 两层嵌套时是同一个位置，短语的线会把句摘的整条盖掉（从前的毛病）。
 * 范围越大线越靠下：单词 < 短语 < 句摘，三者叠在一起时都看得见。
 * 线型也各不相同：直实线 / 波浪线 / 虚线，不必靠长短去分辨。
 *
 * **只有单词那条还走 text-decoration，另外两条都是背景图**
 * （index.css 里的 .phrase-line、.sentence-line），各有各的缘由：
 *
 * - 句摘：一段里套着几十个单词 span，浏览器画下划线是一个子元素一段地画的，
 *   虚线在每个词的接缝处重新起头，看着深一截浅一截
 * - 短语：「要不要给 g、y 的尾巴让路」那个开关会往下传给单词那层，
 *   两条线只要都走 text-decoration 就甩不掉彼此（第五十三节）
 *
 * 单词那条没有这两个毛病 —— 它只画在一个元素上，而且本来就该让路。
 *
 * 这几个数是量出来的，不是估的（18px 字号、行距 1.8 时）：
 * 基线往下 4px 是内容盒底部（从前两条 border-b 都落在这儿，所以会重叠），
 * 9.7px 是行盒底部，再往下还有 5.7px 行间空气才碰到下一行的字顶 ——
 * 也就是说基线以下约 15px 都是安全的。三条线分别落在 2 / 6.5 / 10.8px，
 * 彼此隔开 1.5px 以上，最深的一条离下一行还有 3px 富余。
 */
/*
 * 单词那条直线。
 *
 * `[text-decoration-skip-ink:auto]` 就是浏览器的默认值，写出来是**当个路障**：
 * 这个属性会往下传，将来谁在外面一层关掉「给下伸笔画让路」，这条线就又会跟着
 * 一起穿过 y、g 的尾巴 —— 那正是第五十三节的毛病，别再犯第二回。
 *
 * 单词的线该断就断：它标的是「这一个词」，被自己的字母截开不碍事。
 * 短语那条要一整条不断，改用背景图画（见 index.css 的 .phrase-line），
 * 从此不受这个开关管，两件事各走各的。
 */
const WORD_LINE_CLASS =
  'underline decoration-solid decoration-accent-600 decoration-2 underline-offset-2 [text-decoration-skip-ink:auto]'
/** 短语那条波浪线：背景图，不走 text-decoration，缘由见 index.css 的 .phrase-line */
const PHRASE_LINE_CLASS = 'phrase-line'
const SENTENCE_LINE_CLASS = 'sentence-line'

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
  /** 删除句摘 */
  onDeleteSentence?: (startAnchorId: string, endAnchorId: string) => void
  /** 当前文档下已保存的短语（正文里画一条连续实线） */
  phrases?: PhraseView[]
  /** 保存短语 */
  onAddPhrase?: (phrase: {
    text: string
    definition: string
    usage: string
    docId: string
    startAnchorId: string
    endAnchorId: string
  }) => void
  /** 删除短语 */
  onDeletePhrase?: (startAnchorId: string, endAnchorId: string) => void
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

/**
 * 要让第 n 行贴着 textarea 的顶边，scrollTop 该是多少。
 *
 * 克隆一个同款 textarea（同样的 class、同样的宽度）塞进前 n 行，量它有多高 ——
 * 折行位置和字体度量交给浏览器自己算，比「行高 × 行数」准得多：正文里长短行都有，
 * 一行常常折成两三行。量完就删，用户看不见。
 *
 * 对过一次：40 行处这个算法得 4089px，另用一面「镜子」逐行量得 4093px，
 * 差 4px（行高 28.8px 的七分之一），两种算法互相印证。
 *
 * 加上 paddingTop 才是贴顶：不加的话那一行会落在离顶边约一整行的地方，
 * 上面挂着前一行的尾巴。第 0 行是例外 —— 文首就该看见上面那圈留白。
 */
function scrollTopForLine(ta: HTMLTextAreaElement, text: string, n: number): number {
  if (n <= 0) return 0
  const clone = ta.cloneNode() as HTMLTextAreaElement
  clone.style.position = 'absolute'
  clone.style.visibility = 'hidden'
  clone.style.top = '0'
  clone.style.left = '0'
  // 宽度必须钉死：class 里是 w-full，脱离文档流之后撑不出原来的宽度，
  // 折行位置就全变了
  clone.style.width = `${ta.offsetWidth}px`
  clone.style.height = '0'
  clone.style.minHeight = '0'
  clone.value = text.split('\n').slice(0, n).join('\n')
  ta.parentElement?.appendChild(clone)
  const cs = getComputedStyle(clone)
  // scrollHeight 含上下 padding：减掉下边的，剩下的正好是「上留白 + 前 n 行」
  const top = clone.scrollHeight - parseFloat(cs.paddingBottom)
  clone.remove()
  return top
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
  onDeleteSentence,
  phrases,
  onAddPhrase,
  onDeletePhrase,
  editMode,
  onEditModeChange,
  savedProgress = 0,
  onSaveProgress,
  nextPage,
  onSelectPage,
  onReadingProgressChange,
  readerSettings = { fontSize: 18, fontFamily: 'sans', theme: 'pure', accent: 'amber' }
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

  // 配色表搬去了 ./theme，复习页要用同一份
  const themeStyles = readerThemeStyles(readerSettings.theme)

  const fontStack =
    readerSettings.fontFamily === 'serif'
      ? "'Merriweather', 'Georgia', 'PingFang SC', 'Microsoft YaHei', 'SimHei', sans-serif"
      : readerSettings.fontFamily === 'rounded'
        ? "'Nunito', 'Quicksand', 'Arial Rounded MT Bold', 'PingFang SC', 'Microsoft YaHei', sans-serif"
        : "'Inter', '-apple-system', 'BlinkMacSystemFont', 'PingFang SC', 'Microsoft YaHei', sans-serif"
  const scrollContainerRef = useRef<HTMLDivElement>(null)
  const debounceTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const textareaRef = useRef<HTMLTextAreaElement>(null)

  /**
   * 点「编辑全文」那一刻，屏幕最上面是第几行 —— 趁阅读容器还没卸载先算好存这儿。
   *
   * 阅读和编辑是**两个各自独立的滚动容器**，位置接不上，只能靠「第几行」这个
   * 两边都认得的坐标搬过去。而且编辑模式里真正在滚的是 textarea 自己，不是外面
   * 那层 div —— 量出来的：外层 scrollHeight 692 = clientHeight，根本不滚。
   * 光看 class 里那个 min-h-full 会以为是外层在滚，滚给它也没用。
   */
  const pendingEditLineRef = useRef<number | null>(null)

  /** 阅读页里，屏幕最上面露出来的是第几行（正文一行一个 <p>，带着行号） */
  const topVisibleLine = useCallback((): number => {
    const el = scrollContainerRef.current
    if (!el) return 0
    const top = el.getBoundingClientRect().top
    const paragraphs = el.querySelectorAll<HTMLElement>('[data-line-index]')
    for (const p of paragraphs) {
      // 露出一点点就算它：卡在屏幕顶上被切掉半截的那段，用户读的就是它
      if (p.getBoundingClientRect().bottom > top + 1) {
        return Number(p.dataset.lineIndex)
      }
    }
    return 0
  }, [])

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

  /**
   * 进编辑模式时，把 textarea 滚到刚才读到的那一行。
   *
   * 用 useLayoutEffect 是为了在这一帧画出来之前就滚好，不让用户看见「先闪一下文首
   * 再跳过去」。等 `ta.value === content` 才动手 —— 草稿是在上面那个 useEffect 里
   * 灌的，比这里晚一拍，抢在它前面量的是上一份文字。
   */
  useLayoutEffect(() => {
    const line = pendingEditLineRef.current
    if (!editMode || line === null) return
    const ta = textareaRef.current
    if (!ta || ta.value !== content) return
    pendingEditLineRef.current = null
    ta.scrollTop = scrollTopForLine(ta, content, line)
  }, [editMode, draft, content])

  const [selection, setSelection] = useState<Selection | null>(null)
  const [bubbleForm, setBubbleForm] = useState<WordNote>({ word: '' })
  const [sentenceForm, setSentenceForm] = useState({ grammar: '', meaning: '' })
  const [phraseForm, setPhraseForm] = useState({ definition: '', usage: '' })
  // 底部抽屉当前模式：单词 or 范围（短语/句摘）；null 表示不显示
  const [fullMode, setFullMode] = useState<'word' | 'sentence' | null>(null)

  /**
   * 宽屏上，这一格不再是横贯屏幕的底部抽屉，而是**贴着那个词弹出来的小窗**。
   *
   * 这件事从前就有：2026-08-28 那次「改为纯触摸交互」把桌面端的小气泡连同双击
   * 一起删了（`git show d54ebe4`），当时它是跟着鼠标点击走的，手机上从来不显示。
   * 删得对 —— 但平板出现之后，横屏上一个 1280 宽的抽屉横在底下、还盖住左边的文库列表，
   * 就成了「手机应用拉大了用」。所以把小窗接回来，这回改三点：
   *
   * 1. **跟着长按走**，不再有第二套手势 —— 全平台仍旧只有长按取词这一种
   * 2. **按可用宽度决定**（useWideLayout），不按设备种类。从前那个 useIsMobile 删得对
   * 3. **会自己躲边界**：右边放不下就往左收，下边放不下就翻到词的上面。
   *    老版本是硬套 `left: rect.left, top: rect.bottom + 6`，会跑出屏幕，
   *    那次提交里也写着它「会被软键盘盖住」
   *
   * 窄屏（手机、平板竖屏）一律还是底部抽屉，那套是验熟的。
   */
  const isWide = useIsWide()
  /**
   * 键盘弹起来时，屏幕能用的那一块变矮了 —— 下面摆小窗时要按这个算。
   * 不算的话：长按屏幕下半部分的词，小窗正好落在键盘底下，
   * 开着却整个看不见（量过：词在 y=572，小窗 602–888，键盘顶边 580）。
   */
  const keyboardH = useKeyboardHeight()
  const popupRef = useRef<HTMLDivElement>(null)
  const [popupPos, setPopupPos] = useState<{
    left: number
    top: number
    maxHeight: number
  } | null>(null)
  /**
   * 选中一段之后，它算短语还是句子。
   *
   * 两者的差别只在「记什么」——短语记搭配和释义，句子记句型和翻译，
   * 范围本身没有任何区别，所以不另立一种手势，让用户在抽屉里点一下改。
   */
  const [rangeKind, setRangeKind] = useState<'phrase' | 'sentence'>('sentence')

  /** 几个词以内默认当短语。多数固定搭配都在这个长度内，猜错了点一下就改 */
  const PHRASE_GUESS_MAX_WORDS = 4

  /** 新框出一段时：优先沿用这段已经存过的类型，没存过就按长度猜 */
  const decideRangeKind = useCallback(
    (startAnchorId: string, endAnchorId: string, text: string): 'phrase' | 'sentence' => {
      const savedPhrase = phrases?.find(
        (p) => p.startAnchorId === startAnchorId && p.endAnchorId === endAnchorId
      )
      if (savedPhrase) return 'phrase'
      const savedSentence = sentences?.find(
        (s) => s.startAnchorId === startAnchorId && s.endAnchorId === endAnchorId
      )
      if (savedSentence) return 'sentence'
      const words = text.trim().split(/\s+/).filter(Boolean).length
      return words <= PHRASE_GUESS_MAX_WORDS ? 'phrase' : 'sentence'
    },
    [phrases, sentences]
  )

  /** 打开一段范围：定类型、把已存过的内容填回表单 */
  const openRange = useCallback(
    (startAnchorId: string, endAnchorId: string, text: string) => {
      const kind = decideRangeKind(startAnchorId, endAnchorId, text)
      setRangeKind(kind)
      const savedPhrase = phrases?.find(
        (p) => p.startAnchorId === startAnchorId && p.endAnchorId === endAnchorId
      )
      const savedSentence = sentences?.find(
        (s) => s.startAnchorId === startAnchorId && s.endAnchorId === endAnchorId
      )
      setPhraseForm({
        definition: savedPhrase?.definition ?? '',
        usage: savedPhrase?.usage ?? ''
      })
      setSentenceForm({
        grammar: savedSentence?.grammar ?? '',
        meaning: savedSentence?.meaning ?? ''
      })
      setSelection({ type: 'sentence', startAnchorId, endAnchorId, text })
      setFullMode('sentence')
    },
    [decideRangeKind, phrases, sentences]
  )

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
  /**
   * 算小窗摆在哪。只在宽屏、且抽屉真的开着时算。
   *
   * 摆在选区**最后一行的下面**（而不是第一行下面）—— 划句子时选区可能跨两行，
   * 摆在第一行下面会把自己划的那句盖住一半。
   *
   * 用 useLayoutEffect 是为了在浏览器画之前就把位置定下来，否则会先在屏幕底下
   * 闪一帧抽屉再跳上去。高度要等它真的渲染出来才知道，所以下一拍再量一次校正。
   */
  useLayoutEffect(() => {
    if (!isWide || !fullMode || !selection) {
      setPopupPos(null)
      return
    }

    const place = () => {
      // 键盘占掉的那一截不算数：小窗只能摆在它上面
      const screenH = window.innerHeight - keyboardH
      const startId = selection.type === 'word' ? selection.anchorId : selection.startAnchorId
      const endId = selection.type === 'word' ? selection.anchorId : selection.endAnchorId
      const startEl = document.getElementById(startId)
      const endEl = document.getElementById(endId) ?? startEl
      // 那个词被正文重排冲掉了（改过正文、翻了页）：退回底部抽屉，别硬摆一个错位置
      if (!startEl || !endEl) {
        setPopupPos(null)
        return
      }
      const a = startEl.getBoundingClientRect()
      const b = endEl.getBoundingClientRect()
      const h = popupRef.current?.offsetHeight ?? 280

      // 左右：贴着选区左边缘，但不许越过屏幕两侧
      const left = Math.min(
        Math.max(a.left, POPUP_MARGIN),
        Math.max(POPUP_MARGIN, window.innerWidth - POPUP_W - POPUP_MARGIN)
      )

      /*
       * 上下：**宁可把自己压矮，也不要盖住那个词。**
       *
       * 摆在选区最后一行的下面；下面塞不下就翻到上面。两边都塞不下时，选空间大的那边，
       * 并把最大高度压到那一边的净空 —— 让它自己内部滚动。
       * 早一版是「塞不下就贴着屏幕顶端」，结果 800 高的横屏上，
       * 一个 387px 高的句摘窗直接盖在划中的句子上，等于看不见自己划了什么。
       * 净空实在太小（比如 180px）就不再压了，那时候盖住一点也比挤成一条缝强。
       */
      const bottomEdge = Math.max(a.bottom, b.bottom) + 8
      const topEdge = Math.min(a.top, b.top) - 8
      const spaceBelow = screenH - bottomEdge - POPUP_MARGIN
      const spaceAbove = topEdge - POPUP_MARGIN
      const putBelow = h <= spaceBelow || spaceBelow >= spaceAbove
      const maxHeight = Math.max(MIN_POPUP_H, putBelow ? spaceBelow : spaceAbove)
      const wanted = putBelow
        ? bottomEdge
        : Math.max(POPUP_MARGIN, topEdge - Math.min(h, maxHeight))
      /*
       * 最后再夹一道：**无论如何都得留在屏幕里。**
       * 那个词可能根本不在视野内（正文滚走了，或者是从别处跳过来选中的），
       * 照它算出来的位置会把小窗顶到屏幕外面 —— 开着却看不见，比盖住还糟。
       * 量到过一次：词在 y=1029、屏幕才 800 高，小窗被摆到了 795。
       */
      const top = Math.min(
        Math.max(wanted, POPUP_MARGIN),
        Math.max(POPUP_MARGIN, screenH - Math.min(h, maxHeight) - POPUP_MARGIN)
      )
      setPopupPos({ left, top, maxHeight })
    }

    place()
    // 渲染出来之后再量一次真实高度校正（第一次只能按估值算）
    const settle = window.setTimeout(place, 0)
    // 转屏、滚正文时跟着那个词走
    window.addEventListener('resize', place)
    window.addEventListener('scroll', place, true)
    return () => {
      window.clearTimeout(settle)
      window.removeEventListener('resize', place)
      window.removeEventListener('scroll', place, true)
    }
    // keyboardH 也在里面：键盘一弹起来就得重新摆一次，否则小窗留在原地被盖住
  }, [isWide, fullMode, selection, keyboardH])

  useBackHandler(!!fullMode || !!selection, BackPriority.wordDrawer, () => {
    if (fullMode) setFullMode(null)
    else clearAll()
  })

  // 切换文档时，重置选择与弹窗状态
  useEffect(() => {
    clearAll()
  }, [pageId, clearAll])

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

  /** 已保存短语的 anchor 集合：正文里画一条连续实线 */
  const savedPhraseAnchorSet = useMemo(() => {
    if (!phrases || phrases.length === 0) return new Set<string>()
    const set = new Set<string>()
    for (const p of phrases) {
      // 孤儿短语（原文已删除）不画线，它的坐标已经失效
      if (p.orphaned) continue
      const i = orderedWords.findIndex((w) => w.anchorId === p.startAnchorId)
      const j = orderedWords.findIndex((w) => w.anchorId === p.endAnchorId)
      if (i === -1 || j === -1) continue
      const [lo, hi] = i <= j ? [i, j] : [j, i]
      for (let k = lo; k <= hi; k++) set.add(orderedWords[k].anchorId)
    }
    return set
  }, [phrases, orderedWords])

  /** 当前选中的这段是不是一条已存过的短语（决定要不要显示删除按钮） */
  const canDeletePhrase = useMemo(() => {
    if (!selection || selection.type !== 'sentence' || rangeKind !== 'phrase') return false
    return !!phrases?.some(
      (p) =>
        p.startAnchorId === selection.startAnchorId && p.endAnchorId === selection.endAnchorId
    )
  }, [selection, phrases, rangeKind])

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

  /**
   * 正文里长按一个词，顺带读出来。
   *
   * **只在「第一次长按、进入单词模式」那一下读**（下面第 1 种情况）。
   * 接着点第二个词是在连成短语或句子，那时候读一个词没有意义，也吵 ——
   * 用户明确要的就是这条界线。
   *
   * 词典里没有的词会退回机器音，和别处一样；读不出声的手机就是不响，
   * 长按取词本身不受影响。
   */
  const { speak } = useSpeak()

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
        speak(anchorId, word, { lookup: true })
        return
      }

      // 2. 已经选中一个单词
      if (selection.type === 'word') {
        // 再次长按同一个词：视为取消选中，关闭抽屉与高亮
        if (selection.anchorId === anchorId) {
          clearAll()
          return
        }
        // 长按另一个词：升级为一段范围（短语或句子，抽屉里可切换）
        const { startAnchorId, endAnchorId } = normalizeRange(selection.anchorId, anchorId)
        openRange(startAnchorId, endAnchorId, getRangeText(startAnchorId, endAnchorId))
        return
      }

      // 3. 已经是范围模式：修正范围到新的终点
      if (selection.type === 'sentence') {
        const { startAnchorId, endAnchorId } = normalizeRange(selection.startAnchorId, anchorId)
        openRange(startAnchorId, endAnchorId, getRangeText(startAnchorId, endAnchorId))
      }
    },
    [selection, notes, normalizeRange, getRangeText, clearAll, openRange, speak]
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

        // 点击另一个单词：升级为一段范围 A→B
        const { startAnchorId, endAnchorId } = normalizeRange(selection.anchorId, anchorId)
        openRange(startAnchorId, endAnchorId, getRangeText(startAnchorId, endAnchorId))
        return
      }

      // 2. 当前为范围模式：修正范围起止（保持起点 A 不变）
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

        // 2.2 否则维持范围模式
        openRange(startAnchorId, endAnchorId, getRangeText(startAnchorId, endAnchorId))
      }
    },
    [selection, normalizeRange, getRangeText, orderedWords, clearAll, openRange]
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
    } else if (rangeKind === 'phrase') {
      onAddPhrase?.({
        // 短语不带两头的标点：要拿去词典查真人录音，`he said.` 是查不到的
        text: stripEdgePunctuation(selection.text),
        definition: phraseForm.definition,
        usage: phraseForm.usage,
        docId: pageId,
        startAnchorId: selection.startAnchorId,
        endAnchorId: selection.endAnchorId
      })
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
  }, [
    selection,
    bubbleForm,
    sentenceForm,
    phraseForm,
    rangeKind,
    pageId,
    onNoteSave,
    onAddSentence,
    onAddPhrase,
    clearAll
  ])

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

  const handleDeletePhrase = useCallback(() => {
    if (!selection || selection.type !== 'sentence') return
    onDeletePhrase?.(selection.startAnchorId, selection.endAnchorId)
    clearAll()
  }, [selection, onDeletePhrase, clearAll])

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
        <div className={`${BAND_SUB} bg-white`}>
          <span className="text-sm opacity-80">编辑全文</span>
          <button
            type="button"
            onClick={() => onEditModeChange(false, draft)}
            className="text-sm text-accent-500 hover:text-accent-400 font-medium"
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
            ref={textareaRef}
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
      <div className={`${BAND_SUB} bg-white`}>
        <span className="text-sm opacity-80 truncate">{interactionHint}</span>
        <button
          type="button"
          onClick={() => {
            // 趁阅读容器还在，先记下读到第几行；进去之后照这一行把 textarea 滚过去
            pendingEditLineRef.current = topVisibleLine()
            onEditModeChange(true)
          }}
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
          lineHeight: 1.8,
          /*
           * 底部让出导航栏 —— 加在**滚动区里面**，不加在外面那层。
           * 加在外面的话正文的纸色就到不了屏幕最下沿，app 会像踩在一条空白横条上。
           * 加在里面，纸色一路铺到底，导航键浮在纸上，最后一行也还能滚上来看全。
           * p-8 是 2rem，这里把它和让出的那一条加在一起。
           */
          paddingBottom: 'calc(2rem + var(--sa-bottom))'
        }}
      >
        {lines.map((line, lineIndex) => {
          // 分词之后再把「其它」段两头的标点拆开，句摘那条虚线才盖得住引号句号。
          // 不拆的话 `. “` 是一整段：整段画线会把前一句的句号也画上，不画又盖不到引号。
          const segments = splitEdgePunctuation(tokenizeLine(line))

          /**
           * 算出这一行里，某个坐标集合覆盖了哪几段（连英文词之间的空格、标点一起算进去）。
           * 句摘（虚线）和短语（实线）各算一份 —— 两条线的画法不同，但覆盖范围的算法一样。
           *
           * `withEdges` 决定要不要连两头紧贴的标点一起盖：
           * 句摘要（存下来的原文就带着引号句号），短语不要（存进去的两头是剥干净的，
           * 线比字长就对不上了）。
           */
          const maskFor = (anchorSet: Set<string>, withEdges: boolean): boolean[] => {
            const mask = new Array(segments.length).fill(false)
            if (!anchorSet.size) return mask
            let wordIndexForSaved = 0
            let clusterStart: number | null = null
            let clusterEnd: number | null = null

            // 结束当前簇：簇内全部标上；句摘还要把紧贴两头的标点段一并纳入
            const flush = () => {
              if (clusterStart === null || clusterEnd === null) return
              let lo = clusterStart
              let hi = clusterEnd
              if (withEdges) {
                if (lo > 0 && segments[lo - 1].edge === 'open') lo--
                if (hi < segments.length - 1 && segments[hi + 1].edge === 'close') hi++
              }
              for (let k = lo; k <= hi; k++) mask[k] = true
              clusterStart = null
              clusterEnd = null
            }

            for (let segIdx = 0; segIdx < segments.length; segIdx++) {
              const seg = segments[segIdx]
              if (seg.type === 'en') {
                const anchorIdForSeg = getAnchorId(lineIndex, wordIndexForSaved)
                const isSavedWord = anchorSet.has(anchorIdForSeg)
                if (isSavedWord) {
                  if (clusterStart === null) {
                    clusterStart = segIdx
                  }
                  clusterEnd = segIdx
                } else {
                  flush()
                }
                wordIndexForSaved++
              }
            }
            // 行尾仍有未结束的簇
            flush()
            return mask
          }

          const savedSegmentMask = maskFor(savedSentenceAnchorSet, true)
          const phraseSegmentMask = maskFor(savedPhraseAnchorSet, false)

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
                ? 'bg-accent-300/70'
                : isSelectedWord
                  ? 'bg-accent-200/80'
                  : inSentenceRange
                    ? 'bg-accent-100/70'
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
                    hasNote ? WORD_LINE_CLASS : ''
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

          // 将一行拆分为若干块，按「是否在句摘里 / 是否在短语里」分段。
          // 句摘画虚线、短语画实线；一段话既是句摘又含短语时两条线会叠在一起，
          // 所以用「两个标记合起来」当分块依据，而不是只看句摘。
          const lineChildren: React.ReactNode[] = []
          let segIdx = 0
          const kindOf = (i: number) => `${savedSegmentMask[i] ? 's' : ''}${phraseSegmentMask[i] ? 'p' : ''}`
          while (segIdx < segments.length) {
            const kind = kindOf(segIdx)
            let end = segIdx + 1
            while (end < segments.length && kindOf(end) === kind) {
              end++
            }

            const chunkElems: React.ReactNode[] = []
            for (let k = segIdx; k < end; k++) {
              chunkElems.push(renderInnerSegment(segments[k], k))
            }

            if (kind) {
              // 三条线的位置一律用 em，字号调大时跟着一起长，不会挤到下一行去。
              // 范围越大，线越靠下：单词(2px) < 短语(0.28em) < 句摘(0.62em)，
              // 叠在一起时三条都看得见 —— 从前短语用 border-b，
              // 和句摘的 border-b 落在同一条水平线上，虚线整条被实线盖住。
              // 线型也各不相同：单词直实线、短语波浪线、句摘虚线，一眼可分。
              // 短语和句摘那两条是背景图不是下划线，缘由见文件开头。
              const inner = phraseSegmentMask[segIdx] ? (
                <span className={PHRASE_LINE_CLASS}>{chunkElems}</span>
              ) : (
                chunkElems
              )
              lineChildren.push(
                <span
                  key={`chunk-${lineIndex}-${segIdx}`}
                  className={savedSegmentMask[segIdx] ? SENTENCE_LINE_CLASS : ''}
                >
                  {inner}
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
            <p key={lineIndex} data-line-index={lineIndex} className="mb-6">
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
                className="text-sm hover:underline underline-offset-2 transition-colors py-1 text-ink-muted hover:text-accent-700"
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
            ref={popupRef}
            data-full-popup="true"
            className={
              popupPos
                ? // 宽屏：贴着那个词的一扇小窗。四边都有边框和影子，是「浮在纸上的一张便签」
                  // 宽度和最高多高都写在 style 里，不写成类名 ——
                  // 拼出来的类名 Tailwind 扫不到，不会生成
                  'fixed z-20 bg-white border border-paper-border p-4 rounded-2xl overflow-y-auto'
                : // 窄屏：横贯屏幕的底部抽屉，手机上验熟的那套
                  'fixed z-20 bg-white border-t border-paper-border p-4 left-0 right-0 bottom-0 w-full rounded-t-2xl max-h-[70vh] overflow-y-auto'
            }
            style={
              popupPos
                ? {
                    left: popupPos.left,
                    top: popupPos.top,
                    width: POPUP_W,
                    maxHeight: popupPos.maxHeight,
                    boxShadow: '0 12px 32px -12px rgba(44, 44, 44, 0.3)'
                  }
                : {
                    /*
                     * 抽屉自己坐到键盘上面去。
                     *
                     * 从前不用管：原生把整个窗口往上挤，它跟着就上去了。现在窗口不动了
                     * （见 MainActivity 的说明），不自己让就整个躲在键盘背后 ——
                     * 而这张抽屉里正有要填的格子。
                     */
                    bottom: 'var(--kb, 0px)',
                    // 白底铺到底、里面那排按钮让开导航键（手势条不用让，所以用 -tap 那个数）。
                    // 从前直接用 env()，安卓老版本读不到系统栏，按钮就压在导航键底下了
                    paddingBottom: 'max(var(--sa-bottom-tap), 16px)',
                    boxShadow: '0 -10px 28px -12px rgba(44, 44, 44, 0.22)'
                  }
            }
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-start justify-between gap-3 mb-3">
              <span className="font-lyric-en font-serif text-accent-800 font-bold text-lg leading-snug min-w-0 break-words">
                {/* 抽屉顶上显示的就是待会儿存进去的那一份：切到「短语」时两头的标点先剥掉 */}
                {selection.type === 'word'
                  ? selection.word
                  : rangeKind === 'phrase'
                    ? stripEdgePunctuation(selection.text)
                    : selection.text}
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
              <>
                {/*
                  选中一段之后，它是短语还是句子只有用户知道 —— 这里点一下就改。
                  默认按长度猜（四个词以内当短语），猜对的时候一下都不用点。
                */}
                <div className="flex gap-1.5 mb-3">
                  {(['phrase', 'sentence'] as const).map((kind) => (
                    <button
                      key={kind}
                      type="button"
                      onClick={() => setRangeKind(kind)}
                      className={`flex-1 h-8 rounded-lg text-sm border transition-colors ${
                        rangeKind === kind
                          ? 'border-accent-500 bg-accent-50 text-accent-800 font-medium'
                          : 'border-paper-border text-ink-muted hover:bg-stone-50'
                      }`}
                    >
                      {kind === 'phrase' ? '短语' : '句子'}
                    </button>
                  ))}
                </div>
                {rangeKind === 'phrase' ? (
                  <div className="grid grid-cols-1 gap-2 mb-4">
                    <input
                      type="text"
                      placeholder="中文释义"
                      aria-label="短语释义"
                      className="field-sheet"
                      value={phraseForm.definition}
                      onChange={(e) => setPhraseForm((f) => ({ ...f, definition: e.target.value }))}
                    />
                    <input
                      type="text"
                      placeholder="用法 / 搭配"
                      aria-label="短语用法"
                      className="field-sheet"
                      value={phraseForm.usage}
                      onChange={(e) => setPhraseForm((f) => ({ ...f, usage: e.target.value }))}
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
              </>
            )}
            {/* 保存是主操作，给到 44px；删除退成次要样式，不跟主按钮抢眼 */}
            <div className="flex gap-2">
              <button
                type="button"
                onClick={saveBubble}
                className="flex-1 h-11 rounded-lg bg-accent-600 hover:bg-accent-700 active:bg-accent-800 text-white font-medium text-[15px] transition-colors"
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
              {canDeleteSentence && rangeKind === 'sentence' && (
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
              {canDeletePhrase && (
                <button
                  type="button"
                  onClick={handleDeletePhrase}
                  className="h-11 px-4 rounded-lg bg-stone-100 hover:bg-red-50 text-red-600 font-medium text-[15px] flex items-center gap-1.5 transition-colors"
                  title="删除短语"
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
