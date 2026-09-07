import { useState, useCallback, useEffect, useMemo, useRef } from 'react'
import { Capacitor } from '@capacitor/core'
import type { PluginListenerHandle } from '@capacitor/core'
import { App as CapacitorApp } from '@capacitor/app'
import { Menu, PanelRightOpen, BookOpen, PenLine } from 'lucide-react'
import { LeftSidebar } from './components/LeftSidebar'
import { RightSidebar } from './components/RightSidebar'
import { LyricEditor } from './components/LyricEditor'
import { VocabularyDashboard } from './components/VocabularyDashboard'
import { useExportBackup } from './hooks/useExportBackup'
import type {
  AccentColor,
  Annotation,
  AppData,
  LyricBook,
  LyricPage,
  ReaderSettings,
  Sentence,
  WordNote
} from './types'
import { reconcileAnnotations, markAnnotationOrphaned } from './utils/reconcile'
import {
  annotationToSentence,
  buildNotesIndex,
  buildPhraseList,
  buildSentenceList,
  buildVocabList,
  findAnnotationByKey,
  findRangeAnnotation,
  findWordAnnotation
} from './utils/annotationViews'
import { migratePage } from './utils/migrateTokenizer'
import { importFile } from './importers'
import { AGREEMENT_CLAUSES, AGREEMENT_TITLE } from './agreement'
import { useBackHandler, handleBackPress, BackPriority } from './hooks/useBackHandler'
import { isLeftSidebarVisible, useIsWide } from './hooks/useWideLayout'
import { shouldImmerse, useImmersiveReading } from './hooks/useImmersiveReading'
import { usePanelWidth } from './hooks/usePanelWidth'
import { useLastReadByBook } from './hooks/useLastReadByBook'
import { useSync } from './hooks/useSync'
import { useAutoFill } from './hooks/useAutoFill'
import { useAutoMark } from './hooks/useAutoMark'
import { AutoMarkDialog } from './components/AutoMarkDialog'
import { BAND_TOP } from './components/chrome'
import { AutoFillDialog } from './components/AutoFillDialog'
import {
  getAppData,
  replaceAllData,
  saveBook,
  savePage,
  savePageProgress,
  moveBookToTrash,
  movePageToTrash,
  restoreBook,
  restorePage,
  deleteBookPermanently,
  deletePagePermanently,
  emptyTrash,
  generateId,
  reorderBooks,
  reorderPages,
  addBookWithPages,
  replacePageNotes,
  saveAnnotation,
  deleteAnnotation,
  deleteAnnotations,
  addAnnotations,
  replaceDocAnnotations,
  updateVocabByText,
  runAnnotationMigration
} from './storage'

/** 当前展开的侧栏；null = 都收起。左右互斥，所以一个状态就够 */
type ActivePanel = 'left' | 'right' | null
type AppMode = 'read' | 'review'
type ReviewTarget = { type: 'page'; id: string } | { type: 'book'; id: string } | null

const READER_SETTINGS_KEY = 'lyric-vocab-reader-settings'
const SENTENCES_KEY = 'user_sentences'
const USER_AGREEMENT_KEY = 'user_agreement_v1'
/** 编辑模式下暂存的「编辑前正文」，用于退出时对账；正常流程走完即清除 */
const PRE_EDIT_KEY = 'lyric-vocab-pre-edit'
/** 切词规则变更后的一次性数据迁移标记 */
const TOKENIZER_MIGRATION_KEY = 'lyric-vocab-tokenizer-migrated-v2'
/*
 * 两侧栏在宽屏下拖成了多宽。**只在宽屏用** —— 窄屏那边两栏都是盖住正文的浮层，
 * 拖宽了只会遮更多，所以那边一律用各自的默认值。拖拽本身见 usePanelWidth。
 */
const LEFT_WIDTH_KEY = 'lyric-vocab-left-width'
const LEFT_WIDTH_DEFAULT = 250
/** 左栏拖到头的两个界：再窄装不下「我的文库 + 整理」，再宽就开始吃正文 */
const LEFT_WIDTH_MIN = 200
const LEFT_WIDTH_MAX = 560

const RIGHT_WIDTH_KEY = 'lyric-vocab-right-width'
/** 右栏两种宽度是原本就有的：窄屏 260、宽屏 350 */
const RIGHT_WIDTH_NARROW = 260
const RIGHT_WIDTH_DEFAULT = 350
/** 右栏再窄一张生词卡就挤了（窄屏那 260 是验熟的下限） */
const RIGHT_WIDTH_MIN = 260
const RIGHT_WIDTH_MAX = 560
const defaultReaderSettings: ReaderSettings = {
  fontSize: 18,
  fontFamily: 'sans',
  theme: 'pure',
  accent: 'amber'
}

const ACCENTS: readonly AccentColor[] = ['amber', 'indigo', 'teal', 'rose', 'stone']

function loadReaderSettings(): ReaderSettings {
  try {
    const raw = localStorage.getItem(READER_SETTINGS_KEY)
    if (!raw) return defaultReaderSettings
    const parsed = JSON.parse(raw) as Record<string, unknown>
    const rawTheme = parsed.theme as string | undefined
    const theme: ReaderSettings['theme'] =
      rawTheme === 'pure' || rawTheme === 'original' || rawTheme === 'rice'
        ? rawTheme
        : rawTheme === 'light' || rawTheme === 'mist'
          ? 'original'
          : rawTheme === 'paper'
            ? 'rice'
            : defaultReaderSettings.theme
    return {
      fontSize: typeof parsed.fontSize === 'number' ? Math.min(24, Math.max(12, parsed.fontSize)) : defaultReaderSettings.fontSize,
      fontFamily: (() => {
        const f = parsed.fontFamily as string | undefined
        if (f === 'sans' || f === 'serif' || f === 'rounded') return f
        if (f === 'mono') return 'rounded' as const
        return defaultReaderSettings.fontFamily
      })(),
      theme,
      // 老用户存的设置里没有这一格，落回琥珀 —— 和他们一直看到的一样
      accent: ACCENTS.includes(parsed.accent as AccentColor)
        ? (parsed.accent as AccentColor)
        : defaultReaderSettings.accent
    }
  } catch {
    return defaultReaderSettings
  }
}

/**
 * 读取住在 localStorage 里的旧句摘。
 *
 * 只在启动迁移时用一次。迁移之后句摘就在主库的标注表里了，
 * 这个键不再被写入，也不删除 —— 留着当一份冻结的保险。
 */
function readLegacySentences(): Sentence[] {
  try {
    const raw = localStorage.getItem(SENTENCES_KEY)
    if (!raw) return []
    const parsed = JSON.parse(raw) as unknown
    if (!Array.isArray(parsed)) return []
    return parsed.filter(
      (x: unknown): x is Sentence =>
        typeof x === 'object' &&
        x !== null &&
        typeof (x as Sentence).id === 'string' &&
        typeof (x as Sentence).text === 'string' &&
        typeof (x as Sentence).docId === 'string' &&
        typeof (x as Sentence).date === 'number'
    )
  } catch {
    return []
  }
}

export default function App() {
  const [appData, setAppData] = useState<AppData>({
    books: [],
    pages: [],
    notes: {}
  })
  const [initializing, setInitializing] = useState(true)
  /** 启动迁移跑完了没有。没跑完之前别去动数据，否则改的是还没搬完的那一份 */
  const [dataReady, setDataReady] = useState(false)
  const [userAgreementAccepted, setUserAgreementAccepted] = useState(false)
  const [agreementChecked, setAgreementChecked] = useState(false)
  const [mode, setMode] = useState<AppMode>('read')
  const [reviewTarget, setReviewTarget] = useState<ReviewTarget>(null)
    // 改成这样：启动时先去 localStorage 看看有没有上次存的 ID
  const [currentPageId, setCurrentPageId] = useState<string | null>(() => {
    return localStorage.getItem('last_read_doc_id') || null
  })
  // 加上这个：每次 currentPageId 变了，就自动存一下
  useEffect(() => {
    if (currentPageId) {
      localStorage.setItem('last_read_doc_id', currentPageId)
    }
  }, [currentPageId])

  const [editMode, setEditMode] = useState(false)
  const [reviewEditMode, setReviewEditMode] = useState(false)

  /**
   * 离开复习模式就把生词卡的编辑模式关掉。
   *
   * 这个开关从前只能靠再点一次顶栏那支笔来关，切去阅读模式再切回来它还开着 ——
   * 于是回到复习页时卡片全是输入框、还能左滑删除，而用户以为自己早就退出了。
   * 编辑模式是「这一阵子要整理卡片」的临时状态，出了这一屏就该结束。
   *
   * 换文档、换文库时**不关** —— 那种情况下多半是接着往下整理，关掉反而碍事。
   */
  useEffect(() => {
    if (mode !== 'review') setReviewEditMode(false)
  }, [mode])
  const [activePanel, setActivePanel] = useState<ActivePanel>(null)
  /**
   * 宽屏下左栏收没收起来。窄屏不看这个值 —— 那边左栏是浮层，归 activePanel 管。
   * 默认展开：宽屏上一进来就该看得见文库，和从前一样。
   */
  const [wideLeftHidden, setWideLeftHidden] = useState(false)
  /**
   * 两侧栏的宽度（只在宽屏生效），各自拖、各自记。
   * 缘由和拖拽本身都在 usePanelWidth 里。
   */
  const left = usePanelWidth({
    storageKey: LEFT_WIDTH_KEY,
    initial: LEFT_WIDTH_DEFAULT,
    min: LEFT_WIDTH_MIN,
    max: LEFT_WIDTH_MAX
  })
  const right = usePanelWidth({
    storageKey: RIGHT_WIDTH_KEY,
    initial: RIGHT_WIDTH_DEFAULT,
    min: RIGHT_WIDTH_MIN,
    max: RIGHT_WIDTH_MAX,
    // 右栏那根杆在它的左边缘：往左拖是变宽
    invert: true
  })
  const [scrollTarget, setScrollTarget] = useState<{ pageId: string; anchorId: string } | null>(null)
  /** 「原文已删除」确认弹窗；resolve 用于把用户的选择交回给对账流程 */
  const [orphanPrompt, setOrphanPrompt] = useState<{
    words: string[]
    sentences: Sentence[]
    resolve: (shouldDelete: boolean) => void
  } | null>(null)
  const [documentReadingProgress, setDocumentReadingProgress] = useState(0)
  /**
   * 正文里屏幕上**最后一个还露着的单词**的锚点。笔记栏据此跟着滚（见 followScroll.ts）。
   *
   * 落点是「屏幕上显示的最后一个笔记」，用户 2026-09-04 定的口径。
   * ⚠️ 精确到词而不是到行 —— 一个 <p> 就算一行，而书里一段能占好几屏。
   *
   * 只在**笔记栏开着而且不在编辑模式**时才让阅读器去算 —— 算一次要遍历
   * 这一篇的 <p>，收起来的时候这个数没人要。
   */
  const [lastVisibleAnchor, setLastVisibleAnchor] = useState<string | null>(null)
  /**
   * 刚亲手划下的那条笔记的起点坐标。
   *
   * 它是唯一能**盖过「手动滚了侧栏就暂停跟随」**的东西：那是用户上一秒的动作，
   * 注意力就在那儿。带一个时间戳是因为同一个坐标可能连着划两次（改了释义再存），
   * 光看坐标本身值没变，跟随就不会重新触发。
   */
  const [savedNoteFocus, setSavedNoteFocus] = useState<{ anchor: string; at: number } | null>(null)
  /** 亲手存下一条笔记时记一下落点。AI 划词那一批**不走这里**（见第七十节） */
  const focusSavedNote = useCallback((anchor: string | null | undefined) => {
    if (anchor) setSavedNoteFocus({ anchor, at: Date.now() })
  }, [])
  const [reviewVocabCount, setReviewVocabCount] = useState(0)
  const [readerSettings, setReaderSettings] = useState<ReaderSettings>(loadReaderSettings)

  /**
   * 标注表：单词、短语、句子的唯一权威数据。
   *
   * 界面各处要的形状不一样（阅读页按坐标查、复习页要排好序的列表），
   * 都从这一份算出来 —— 见 utils/annotationViews。改数据一律回到标注表上改。
   */
  const annotations = useMemo(() => appData.annotations ?? [], [appData.annotations])
  const notesIndex = useMemo(() => buildNotesIndex(annotations), [annotations])
  const sentences = useMemo(() => buildSentenceList(annotations), [annotations])

  /**
   * 给回调读最新数据用。
   *
   * 不能直接把 appData / annotations 写进回调的依赖里 —— 那样每次数据一变，
   * 回调就是个新函数，传下去会把 LyricEditor 等组件的 memo 打破，
   * 于是滚动时（进度保存会更新 appData）整棵树又开始重渲染，
   * 正好把之前做的「渲染隔离」抵消掉。
   */
  const dataRef = useRef(appData)
  dataRef.current = appData

  useEffect(() => {
    try {
      const flag = localStorage.getItem(USER_AGREEMENT_KEY)
      if (flag === 'accepted') {
        setUserAgreementAccepted(true)
      }
    } catch {
      // 忽略读取错误，视为未同意
    } finally {
      setAgreementChecked(true)
    }
  }, [])

  useEffect(() => {
    try {
      localStorage.setItem(READER_SETTINGS_KEY, JSON.stringify(readerSettings))
    } catch {
      // ignore
    }
  }, [readerSettings])

  /**
   * 强调色挂到 <html data-accent> 上。
   * 色阶是 CSS 变量（见 index.css），换一个属性值全 App 119 处一起变，
   * 不用重新编译也不用刷新。
   */
  useEffect(() => {
    document.documentElement.dataset.accent = readerSettings.accent
  }, [readerSettings.accent])

  const exportBackup = useExportBackup()

  const refreshData = useCallback(async () => {
    try {
      const data = await getAppData()
      setAppData(data)
    } catch {
      // 读取失败时保持现有内存数据
    }
  }, [])

  /**
   * 两台设备同步（坚果云）。
   *
   * 时机住在这儿而不是设置页里：**设置页关着的时候也要同步** ——
   * 回到前台自动拉一次、改完东西过几秒自动传一次，见 useSync。
   * 设置页只负责显示状态和那颗手动按钮。
   */
  const { status: syncStatus, syncManually, notifyChanged } = useSync(refreshData)

  /**
   * 数据一变就知会同步一声（它自己会等几秒，连续编辑只传一次）。
   *
   * 挂在这儿是因为**所有写操作最后都会走一遍 refreshData** ——
   * 逐个写入口去挂钩子迟早漏一处，而漏掉的那处就是「改了不同步」。
   */
  useEffect(() => {
    notifyChanged()
  }, [appData, notifyChanged])

  useEffect(() => {
    let cancelled = false
    ;(async () => {
      try {
        const data = await getAppData()
        if (!cancelled) {
          setAppData(data)
        }
      } finally {
        if (!cancelled) {
          setInitializing(false)
        }
      }
    })()
    return () => {
      cancelled = true
    }
  }, [])

  const activeBooks = useMemo(() => appData.books.filter((b) => !b.deletedAt), [appData.books])
  const activePages = useMemo(() => appData.pages.filter((p) => !p.deletedAt), [appData.pages])
  const deletedBooks = useMemo(() => appData.books.filter((b) => b.deletedAt), [appData.books])
  const deletedPages = useMemo(() => appData.pages.filter((p) => p.deletedAt), [appData.pages])
  const trashCount = deletedBooks.length + deletedPages.length

  const currentPage = useMemo(
    () => activePages.find((p) => p.id === currentPageId) ?? null,
    [activePages, currentPageId]
  )

  /** 同文库/同组内的上一章、下一章及当前文档在组内索引（按侧栏顺序） */
  const { prevPage, nextPage, currentDocIndex, totalDocsInFolder } = useMemo(() => {
    if (!currentPage) return { prevPage: null, nextPage: null, currentDocIndex: 0, totalDocsInFolder: 0 }
    const bookId = currentPage.bookId
    const siblings = activePages.filter((p) => p.bookId === bookId)
    const idx = siblings.findIndex((p) => p.id === currentPage.id)
    if (idx === -1) return { prevPage: null, nextPage: null, currentDocIndex: 0, totalDocsInFolder: siblings.length }
    const prev = idx > 0 ? siblings[idx - 1] : null
    const next = idx < siblings.length - 1 ? siblings[idx + 1] : null
    return {
      prevPage: prev ? { id: prev.id, title: prev.title || '未命名' } : null,
      nextPage: next ? { id: next.id, title: next.title || '未命名' } : null,
      currentDocIndex: idx,
      totalDocsInFolder: siblings.length
    }
  }, [currentPage, activePages])

  /**
   * 每个文库各自的「上次读到哪一篇」—— 目录里把那几篇的图标点亮。
   *
   * 用户提的：文库多、每个文库里文档也多，在 A 里读一篇跳去 B 读一篇，
   * 回头想接着读 A 就得凭记忆在一长串里找。一个文库一枚书签，跳回去一眼就看见。
   * 规矩见 src/lastRead.ts。
   */
  const lastReadPages = useLastReadByBook(currentPage, activePages)

  /** 移动端顶部栏标题：阅读模式=当前文档名，复习模式=选中的文档名或文库名 */
  const mobileHeaderTitle = useMemo(() => {
    if (mode === 'read') {
      return currentPage?.title ?? '语言学习笔记本'
    }
    if (mode === 'review' && reviewTarget) {
      if (reviewTarget.type === 'page') {
        return activePages.find((p) => p.id === reviewTarget.id)?.title ?? '未命名'
      }
      return activeBooks.find((b) => b.id === reviewTarget.id)?.name ?? '未命名'
    }
    return '复习'
  }, [mode, reviewTarget, currentPage, activePages, activeBooks])

  const notesForCurrent = useMemo(
    () => (currentPageId ? (notesIndex[currentPageId] ?? {}) : {}),
    [notesIndex, currentPageId]
  )

  const sentencesForCurrent = useMemo(
    () => (currentPageId ? sentences.filter((s) => s.docId === currentPageId) : []),
    [sentences, currentPageId]
  )

  /** 当前文档的短语。阅读页据此画线、开抽屉 */
  const phrasesForCurrent = useMemo(
    () => (currentPageId ? buildPhraseList(annotations, currentPageId) : []),
    [annotations, currentPageId]
  )

  /** 右侧生词板：单词与短语混在一起、按正文顺序排（和复习页同一条路） */
  const vocabList = useMemo(
    () => buildVocabList(annotations, new Set(activePages.map((p) => p.id))),
    [annotations, activePages]
  )

  useEffect(() => {
    if (!currentPageId && activePages.length > 0) {
      setCurrentPageId(activePages[0].id)
    }
  }, [currentPageId, activePages])

  useEffect(() => {
    if (!currentPageId) setDocumentReadingProgress(0)
  }, [currentPageId])

  useEffect(() => {
    if (mode !== 'review' || !reviewTarget) setReviewVocabCount(0)
  }, [mode, reviewTarget])

  /** 切换文档时按内容决定编辑/阅读模式：空文档自动进入编辑，有内容则进入阅读 */
  useEffect(() => {
    if (currentPage) {
      const isEmpty = !currentPage.content || currentPage.content.trim() === ''
      setEditMode(isEmpty)
    }
  }, [currentPage?.id])

  useEffect(() => {
    if (!scrollTarget) return
    if (scrollTarget.pageId !== currentPageId) {
      setCurrentPageId(scrollTarget.pageId)
      return
    }
    const el = document.getElementById(scrollTarget.anchorId)
    if (el) {
      el.scrollIntoView({ behavior: 'smooth', block: 'center' })
    }
    setScrollTarget(null)
  }, [scrollTarget, currentPageId])

  const handleAddBook = useCallback(() => {
    void (async () => {
      const book: LyricBook = {
        id: generateId(),
        name: `文库 ${activeBooks.length + 1}`,
        createdAt: Date.now()
      }
      await saveBook(book)
      await refreshData()
    })()
  }, [activeBooks.length, refreshData])

  const handleMoveBookToTrash = useCallback(
    (bookId: string) => {
      void (async () => {
        await moveBookToTrash(bookId)
        if (currentPageId && activePages.some((p) => p.bookId === bookId && p.id === currentPageId)) {
          const rest = activePages.filter((p) => p.bookId !== bookId)
          setCurrentPageId(rest[0]?.id ?? null)
        }
        await refreshData()
      })()
    },
    [currentPageId, activePages, refreshData]
  )

  const handleMovePageToTrash = useCallback(
    (pageId: string) => {
      void (async () => {
        await movePageToTrash(pageId)
        if (currentPageId === pageId) setCurrentPageId(null)
        await refreshData()
      })()
    },
    [currentPageId, refreshData]
  )

  const handleRenameBook = useCallback(
    (bookId: string, name: string) => {
      const book = appData.books.find((b) => b.id === bookId)
      if (book) {
        void (async () => {
          await saveBook({ ...book, name: name.trim() || book.name })
          await refreshData()
        })()
      }
    },
    [appData.books, refreshData]
  )

  const handleRenamePage = useCallback(
    (pageId: string, title: string) => {
      const page = appData.pages.find((p) => p.id === pageId)
      if (page) {
        void (async () => {
          await savePage({ ...page, title: title.trim() || page.title || '未命名' })
          await refreshData()
        })()
      }
    },
    [appData.pages, refreshData]
  )

  const handleRestoreBook = useCallback((bookId: string) => {
    void (async () => {
      await restoreBook(bookId)
      await refreshData()
    })()
  }, [refreshData])

  const handleRestorePage = useCallback((pageId: string) => {
    void (async () => {
      await restorePage(pageId)
      await refreshData()
    })()
  }, [refreshData])

  const handleDeleteBookPermanently = useCallback(
    (bookId: string) => {
      void (async () => {
        await deleteBookPermanently(bookId)
        if (currentPageId && appData.pages.some((p) => p.bookId === bookId && p.id === currentPageId))
          setCurrentPageId(null)
        await refreshData()
      })()
    },
    [currentPageId, appData.pages, refreshData]
  )

  const handleDeletePagePermanently = useCallback(
    (pageId: string) => {
      void (async () => {
        await deletePagePermanently(pageId)
        if (currentPageId === pageId) setCurrentPageId(null)
        await refreshData()
      })()
    },
    [currentPageId, refreshData]
  )

  /**
   * 清空回收站。
   *
   * 正在读的那一篇理论上不会躺在回收站里（删的时候就跳开了），
   * 但恢复、删除、多处入口混着用时不好打包票，所以清完再核一遍：
   * 当前这篇要是没了，就退回没有选中文档的状态，免得界面指着一个不存在的东西。
   */
  const handleEmptyTrash = useCallback(() => {
    void (async () => {
      const next = await emptyTrash()
      if (currentPageId && !next.pages.some((p) => p.id === currentPageId)) {
        setCurrentPageId(null)
      }
      await refreshData()
    })()
  }, [currentPageId, refreshData])

  const handleSelectPage = useCallback((page: LyricPage) => {
    setCurrentPageId(page.id)
    setActivePanel(null)
  }, [])

  const handleReviewTargetChange = useCallback((target: ReviewTarget) => {
    setReviewTarget(target)
    setActivePanel(null)
  }, [])

  const handleAddPage = useCallback(
    (bookId: string) => {
      void (async () => {
        const page: LyricPage = {
          id: generateId(),
          bookId,
          title: '未命名文档',
          content: '',
          updatedAt: Date.now()
        }
        await savePage(page)
        await refreshData()
        setCurrentPageId(page.id)
        setEditMode(true)
      })()
    },
    [refreshData]
  )

  const handleContentChange = useCallback(
    (content: string) => {
      if (!currentPage) return
      void (async () => {
        await savePage({ ...currentPage, content })
        await refreshData()
      })()
    },
    [currentPage, refreshData]
  )

  /**
   * 存阅读进度。
   *
   * ⚠️ 走 `savePageProgress` 而不是 `savePage` —— 后者会刷新 `updatedAt`，
   * 而那一格在同步索引里。一路往下读时每次滚动都刷它的话，
   * 索引每分钟都在变，进度拆出去单独传就白拆了。
   */
  const handleSaveProgress = useCallback(
    (scrollTop: number) => {
      if (!currentPage) return
      void (async () => {
        await savePageProgress(currentPage.id, scrollTop)
        await refreshData()
      })()
    },
    [currentPage, refreshData]
  )

  /**
   * 保存一条单词笔记。
   *
   * 这个坐标上已经有标注就改它（id 不变），没有才新建。
   * 「按坐标找、按 id 存」是新模型的日常形态：坐标只是找人的线索，不是身份。
   */
  const handleNoteSave = useCallback(
    (anchorId: string, note: WordNote) => {
      if (!currentPageId) return
      void (async () => {
        const latest = dataRef.current
        const existing = findWordAnnotation(latest.annotations ?? [], currentPageId, anchorId)
        const fields = {
          text: note.word,
          phonetic: note.phonetic,
          pos: note.pos,
          definition: note.definition
        }
        const next: Annotation = existing
          ? { ...existing, ...fields }
          : {
              id: generateId(),
              docId: currentPageId,
              type: 'word',
              start: anchorId,
              end: anchorId,
              createdAt: Date.now(),
              ...fields
            }
        // 用户亲手写的，就不再算 AI 填的 —— 那个标记本质是「待复核清单」
        delete next.auto
        setAppData(await saveAnnotation(next))
        focusSavedNote(next.start)
      })()
    },
    [currentPageId, focusSavedNote]
  )

  const handleNoteDelete = useCallback(
    (anchorId: string) => {
      if (!currentPageId) return
      const target = findWordAnnotation(dataRef.current.annotations ?? [], currentPageId, anchorId)
      if (!target) return
      void (async () => setAppData(await deleteAnnotation(target.id)))()
    },
    [currentPageId]
  )

  /**
   * 询问用户如何处置「原文已删除」的笔记。
   * 用 Promise 包住 app 内弹窗，让调用方可以像 window.confirm 一样 await，
   * 但不会像系统弹窗那样卡住 JS 线程、把页面布局弄坏。
   */
  const askOrphanDecision = useCallback(
    (words: string[], orphanSentences: Sentence[]): Promise<boolean> =>
      new Promise<boolean>((resolve) => {
        setOrphanPrompt({ words, sentences: orphanSentences, resolve })
      }),
    []
  )

  const closeOrphanPrompt = useCallback((shouldDelete: boolean) => {
    setOrphanPrompt((current) => {
      current?.resolve(shouldDelete)
      return null
    })
  }, [])

  /**
   * 全 app 唯一的安卓返回键监听。
   *
   * 各组件把「自己这一层怎么关」登记到 useBackHandler，这里按优先级只关最上面的一层。
   * 注意：一旦接管了返回键，系统默认行为就不会再发生，所以没东西可关时必须自己收尾，
   * 否则在主界面按返回会毫无反应。
   *
   * **收尾用的是 minimizeApp，不是 exitApp。** 从前写的是 exitApp —— 那是真退出，
   * 进程直接结束，从主界面按一下返回整个 App 就没了，任务列表里也不剩。
   * minimizeApp 等同于按 Home：界面留在后台，再点图标回到原来那一屏。
   * 这才是安卓上一贯的行为。也正因为退到后台什么都不丢，不需要再加「按两次退出」。
   */
  useEffect(() => {
    if (!Capacitor.isNativePlatform()) return
    let handle: PluginListenerHandle | undefined
    let cancelled = false

    void CapacitorApp.addListener('backButton', () => {
      if (!handleBackPress()) void CapacitorApp.minimizeApp()
    }).then((h) => {
      if (cancelled) void h.remove()
      else handle = h
    })

    return () => {
      cancelled = true
      void handle?.remove()
    }
  }, [])

  // 返回键可关闭的层（从上到下）
  useBackHandler(!!orphanPrompt, BackPriority.orphanPrompt, () => closeOrphanPrompt(false))
  useBackHandler(activePanel !== null, BackPriority.panel, () => setActivePanel(null))
  useBackHandler(editMode, BackPriority.editMode, () => handleEditModeChange(false))

  /**
   * 正文编辑后的「笔记对账」。
   *
   * 笔记挂在坐标（第几行第几个词）上，正文一改坐标就会错位。这里拿编辑前的快照
   * 和编辑后的正文对比，算出对照表，把笔记和句摘搬到新位置；实在找不到对应原文的，
   * 列出来问用户是否一并删除（默认保留，因为这些释义都是一条条敲进去的）。
   */
  const reconcileAfterEdit = useCallback(
    async (pageId: string, oldContent: string, newContent: string) => {
      if (oldContent === newContent) return

      const data = await getAppData()
      const pageAnnotations = (data.annotations ?? []).filter((a) => a.docId === pageId)
      if (pageAnnotations.length === 0) return

      const result = reconcileAnnotations(oldContent, newContent, pageAnnotations)
      if (!result.changed) return

      let toWrite = result.annotations

      if (result.newOrphans.length > 0) {
        // 用 app 自己的弹窗询问，而不是 window.confirm。
        // 系统弹窗会卡住整个 JS 线程，而此刻输入法刚收起、窗口正在变回原高，
        // 页面因此拿不到这次尺寸变化，就会卡在被压扁的高度上（下半屏留一块空白）。
        const orphanWords = result.newOrphans
          .filter((a) => a.type !== 'sentence')
          .map((a) => a.text)
          .filter(Boolean)
        const orphanSentences = result.newOrphans
          .filter((a) => a.type === 'sentence')
          .map(annotationToSentence)

        const shouldDelete = await askOrphanDecision(orphanWords, orphanSentences)

        // 选保留：位置置空即可。旧模型这里要给每条编一个假坐标，
        // 否则要么给顶替上来的词画了线，要么被占了坐标的笔记悄悄丢掉。
        if (!shouldDelete) {
          toWrite = [...result.annotations, ...result.newOrphans.map(markAnnotationOrphaned)]
        }
      }

      setAppData(await replaceDocAnnotations(pageId, toWrite))
    },
    [askOrphanDecision]
  )

  const handleEditModeChange = useCallback(
    (next: boolean, finalContent?: string) => {
      if (next) {
        // 进入编辑：拍一份正文快照。顺手写进 localStorage —— 万一编辑途中 App 被杀掉，
        // 下次启动还能把这次对账补上。
        if (currentPage) {
          try {
            localStorage.setItem(
              PRE_EDIT_KEY,
              JSON.stringify({ pageId: currentPage.id, content: currentPage.content })
            )
          } catch {
            // 存不下就算了，大不了这次不对账
          }
        }
        setEditMode(true)
        return
      }

      // 先让输入框失焦收起键盘，再走后面的流程，避免弹窗和键盘收起撞在一起
      if (document.activeElement instanceof HTMLElement) document.activeElement.blur()

      setEditMode(false)
      const pageId = currentPage?.id
      let snapshot: string | null = null
      try {
        const raw = localStorage.getItem(PRE_EDIT_KEY)
        if (raw) {
          const parsed = JSON.parse(raw) as { pageId: string; content: string }
          if (parsed.pageId === pageId) snapshot = parsed.content
        }
        localStorage.removeItem(PRE_EDIT_KEY)
      } catch {
        snapshot = null
      }

      if (pageId && snapshot !== null) {
        const latest = finalContent ?? currentPage?.content ?? ''
        void reconcileAfterEdit(pageId, snapshot, latest)
      }
    },
    [currentPage, reconcileAfterEdit]
  )

  // 编辑途中 App 被系统杀掉的补救：启动时若发现残留的「编辑前快照」，把那次对账补上。
  // 正常退出编辑时快照会被清掉，所以这里能捡到东西就说明上次没走完流程。
  const recoveredRef = useRef(false)
  useEffect(() => {
    if (!dataReady || recoveredRef.current) return
    recoveredRef.current = true

    let snapshot: { pageId: string; content: string } | null = null
    try {
      const raw = localStorage.getItem(PRE_EDIT_KEY)
      if (raw) snapshot = JSON.parse(raw) as { pageId: string; content: string }
      localStorage.removeItem(PRE_EDIT_KEY)
    } catch {
      snapshot = null
    }
    if (!snapshot) return

    const page = appData.pages.find((p) => p.id === snapshot!.pageId)
    if (!page) return
    void reconcileAfterEdit(snapshot.pageId, snapshot.content, page.content)
  }, [dataReady, appData.pages, reconcileAfterEdit])

  /**
   * 启动时的一次性数据迁移，两步，顺序不能颠倒。
   *
   * 1. 分词迁移：切词规则改过（统一两种撇号、拆出缩写后缀、数字纳入单词、
   *    落单的连字符不再算词），同一段正文数出来的词序号和从前对不上，
   *    要把旧笔记按字符位置搬到新编号上。它改的是**旧形状**的数据。
   * 2. 标注迁移：把旧的 notes + 句摘合并成统一的标注表。
   *
   * 必须先 1 后 2 —— 反过来的话，标注表是拿还没修正的坐标建的，
   * 而第 1 步只认旧形状，改完也不会反映到标注表里。
   *
   * 两步各有各的守卫：分词迁移用 localStorage 标记，标注迁移的标记存在数据里
   * （见 storage.runAnnotationMigration 的注释，那里说明了为什么不能用 localStorage）。
   */
  const migratedRef = useRef(false)
  useEffect(() => {
    if (initializing || migratedRef.current) return
    migratedRef.current = true

    void (async () => {
      // 句摘的老家是 localStorage。迁移之后它就只是一份冻结的备份，不再被写入。
      const legacySentences = readLegacySentences()

      // —— 第 1 步：分词迁移 ——
      let tokenizerDone = true
      try {
        tokenizerDone = localStorage.getItem(TOKENIZER_MIGRATION_KEY) === 'done'
      } catch {
        tokenizerDone = true // 读不到 localStorage 就别乱改用户数据
      }

      let sentencesForMigration = legacySentences
      if (!tokenizerDone) {
        try {
          const data = await getAppData()
          const migrated: Sentence[] = []

          for (const page of data.pages) {
            const pageNotes = data.notes[page.id] ?? {}
            const pageSentences = legacySentences.filter((s) => s.docId === page.id)
            if (Object.keys(pageNotes).length === 0 && pageSentences.length === 0) continue

            const result = migratePage(page.content, pageNotes, pageSentences)
            if (!result.changed) {
              migrated.push(...pageSentences)
              continue
            }
            await replacePageNotes(page.id, result.notes)
            migrated.push(...result.sentences)
          }

          const touchedDocs = new Set(migrated.map((s) => s.docId))
          sentencesForMigration = [
            ...legacySentences.filter((s) => !touchedDocs.has(s.docId)),
            ...migrated
          ]
          localStorage.setItem(TOKENIZER_MIGRATION_KEY, 'done')
        } catch {
          // 迁移失败就先不打标记，下次启动再试；数据保持原样
        }
      }

      // —— 第 2 步：标注迁移 ——
      try {
        const { data } = await runAnnotationMigration(sentencesForMigration)
        setAppData(data)
      } catch {
        // 失败也不打标记，下次启动再试
      } finally {
        setDataReady(true)
      }
    })()
  }, [initializing])

  /** 从生词板删除一条单词笔记（目前只有「原文已删除」的条目会露出这个入口） */
  const handleDeleteVocabNote = useCallback(
    (pageId: string, anchorId: string) => {
      // 传回来的键有两种：正常笔记是坐标，孤儿是它自己的 id
      const target = findAnnotationByKey(dataRef.current.annotations ?? [], pageId, anchorId)
      if (!target) return
      void (async () => setAppData(await deleteAnnotation(target.id)))()
    },
    []
  )

  /** 从生词板删除一条句摘 */
  const handleDeleteSentenceById = useCallback((id: string) => {
    void (async () => setAppData(await deleteAnnotation(id)))()
  }, [])

  /**
   * 复习页编辑模式下左滑删掉一条笔记。
   *
   * 按 id 删，词、短语、句摘走同一条路 —— 标注模型统一之后它们本来就是一种东西。
   * **删了就是真没了**，标注不进回收站，所以界面那边是「滑开露出按钮、再点一下」
   * 的两步，不是滑到底就删。
   */
  const handleDeleteAnnotationById = useCallback((id: string) => {
    void (async () => setAppData(await deleteAnnotation(id)))()
  }, [])

  /** 恢复备份。提成稳定引用，否则 LeftSidebar 的 memo 会被这个内联函数破坏。 */
  const handleRestoreBackup = useCallback((file: File) => {
            if (!window.confirm('恢复备份将覆盖现有数据，是否继续？')) return
            const reader = new FileReader()
            reader.onload = () => {
              void (async () => {
                try {
                  const raw = reader.result as string
                  const data = JSON.parse(raw) as AppData & { sentences?: Sentence[] }
                  const valid =
                    data &&
                    Array.isArray(data.books) &&
                    Array.isArray(data.pages) &&
                    data.notes != null &&
                    typeof data.notes === 'object'
                  if (!valid) {
                    window.alert('备份文件格式无效，缺少 books / pages / notes 字段')
                    return
                  }

                  // 先恢复主数据（文库 / 文档 / 生词）。
                  // 必须走 replaceAllData：直接写 IndexedDB 的话，存储层内存中的那份
                  // 还是旧数据，界面不会更新，而且下一次保存会把恢复的内容又覆盖回去。
                  setAppData(await replaceAllData(data))

                  // 备份可能是「统一标注模型」之前导出的：那种备份里句摘是单独一份，
                  // 主库里没有标注表。补跑一次迁移把它们合并进来，
                  // 否则恢复回来的笔记一条都不会出现在界面上。
                  // 备份里已经带标注表的话，这一步会自己跳过。
                  const restoredSentences = Array.isArray(data.sentences)
                    ? data.sentences.filter(
                        (x: unknown): x is Sentence =>
                          typeof x === 'object' &&
                          x !== null &&
                          typeof (x as Sentence).id === 'string' &&
                          typeof (x as Sentence).text === 'string' &&
                          typeof (x as Sentence).docId === 'string' &&
                          typeof (x as Sentence).date === 'number'
                      )
                    : []
                  const { data: migrated } = await runAnnotationMigration(restoredSentences)
                  setAppData(migrated)

                  setCurrentPageId(null)
                } catch (e) {
                  const msg = e instanceof Error ? e.message : String(e)
                  window.alert('恢复备份失败: ' + msg)
                }
              })()
            }
            reader.readAsText(file)
  }, [refreshData])

  /** 上一章 / 下一章跳转。提成稳定引用，否则 LyricEditor 的 memo 会被这个内联函数破坏。 */
  const handleSelectPageById = useCallback((pageId: string) => {
    setCurrentPageId(pageId)
    setActivePanel(null)
  }, [])

  /**
   * 保存句摘。
   *
   * 同一段范围已经有句摘就改它，没有才新建 —— 和单词笔记同一个规矩。
   * （旧实现在这里一律新增：从右侧栏点进来改一条已有句摘，
   * 保存后会多出一条一模一样的。）
   */
  const handleAddSentence = useCallback(
    (s: {
      text: string
      grammar: string
      meaning: string
      docId: string
      startAnchorId: string
      endAnchorId: string
    }) => {
      void (async () => {
        const latest = dataRef.current
        const existing = findRangeAnnotation(
          latest.annotations ?? [],
          s.docId,
          s.startAnchorId,
          s.endAnchorId
        )
        const next: Annotation = existing
          ? { ...existing, text: s.text, grammar: s.grammar, meaning: s.meaning }
          : {
              id: generateId(),
              docId: s.docId,
              type: 'sentence',
              start: s.startAnchorId,
              end: s.endAnchorId,
              text: s.text,
              createdAt: Date.now(),
              grammar: s.grammar,
              meaning: s.meaning
            }
        delete next.auto // 用户亲手写的，不再算 AI 填的
        setAppData(await saveAnnotation(next))
        focusSavedNote(next.start)
      })()
    },
    [focusSavedNote]
  )

  /**
   * 保存短语。
   *
   * 和句摘同一段范围可以并存（同一句话既想记句型、又想记里面的搭配），
   * 所以查重时必须连类型一起对，否则会改到句摘头上。
   *
   * 释义存 definition、用法存 grammar —— 和单词、句子共用同一批字段，
   * 备份、对账、迁移都不必为短语再开一路。
   */
  const handleAddPhrase = useCallback(
    (p: {
      text: string
      definition: string
      usage: string
      docId: string
      startAnchorId: string
      endAnchorId: string
    }) => {
      void (async () => {
        const latest = dataRef.current
        const existing = findRangeAnnotation(
          latest.annotations ?? [],
          p.docId,
          p.startAnchorId,
          p.endAnchorId,
          'phrase'
        )
        const next: Annotation = existing
          ? { ...existing, text: p.text, definition: p.definition, grammar: p.usage }
          : {
              id: generateId(),
              docId: p.docId,
              type: 'phrase',
              start: p.startAnchorId,
              end: p.endAnchorId,
              text: p.text,
              createdAt: Date.now(),
              definition: p.definition,
              grammar: p.usage
            }
        delete next.auto // 用户亲手写的，不再算 AI 填的
        setAppData(await saveAnnotation(next))
        focusSavedNote(next.start)
      })()
    },
    [focusSavedNote]
  )

  /** 从阅读页删除一条短语（按范围找） */
  const handleDeletePhrase = useCallback(
    (startAnchorId: string, endAnchorId: string) => {
      if (!currentPageId) return
      const target = findRangeAnnotation(
        dataRef.current.annotations ?? [],
        currentPageId,
        startAnchorId,
        endAnchorId,
        'phrase'
      )
      if (!target) return
      void (async () => setAppData(await deleteAnnotation(target.id)))()
    },
    [currentPageId]
  )

  /**
   * 点生词板里的词：跳到它在正文里的位置，**但不收起面板**。
   *
   * 从前是跳完顺手把面板关掉的。改成留着，是为了能接着点下一个词
   * —— 生词板这时候更像一张清单，一个个点过去听发音、看位置。
   *
   * 手机上面板是盖在正文上的（宽屏才是并排），所以跳过去的那一行
   * 多半被挡着看不见；滚动位置是实打实变了的，关掉面板就在那儿。
   * 量过：375px 屏上面板占掉右边 260px，正文只剩最左边 115px。
   *
   * 句摘那边的「编辑」仍然会收起面板 —— 那个动作是要在正文里改东西，
   * 面板挡着就没法改了，跟这里不是一回事。
   */
  const handleScrollToWord = useCallback((pageId: string, anchorId: string) => {
    setScrollTarget({ pageId, anchorId })
  }, [])

  /**
   * 点句摘卡右边那条箭头：跳到这句话在正文里的位置，**只做这一件事**。
   *
   * 从前它还顺手收起面板、弹出底部抽屉改语法和翻译。现在和生词卡点词一个规矩 ——
   * 生词板是一张清单，点条目是去看它在哪，不是去改它。
   * 改语法和翻译在复习页的句摘卡里（编辑模式），那边两格都能改。
   */
  const handleScrollToSentence = useCallback((sentence: Sentence) => {
    setScrollTarget({ pageId: sentence.docId, anchorId: sentence.startAnchorId })
  }, [])

  const handleDeleteSentence = useCallback(
    (startAnchorId: string, endAnchorId: string) => {
      if (!currentPageId) return
      const target = findRangeAnnotation(
        dataRef.current.annotations ?? [],
        currentPageId,
        startAnchorId,
        endAnchorId
      )
      if (!target) return
      void (async () => setAppData(await deleteAnnotation(target.id)))()
    },
    [currentPageId]
  )

  // 排序逻辑只在存储层实现一份；这里拿它算好的结果直接更新界面。
  // （原来 App 里还各自重算了一遍顺序做乐观更新，两份逻辑要手工保持一致。）
  const handleReorderBooks = useCallback((orderedIds: string[]) => {
    void (async () => setAppData(await reorderBooks(orderedIds)))()
  }, [])

  const handleReorderPages = useCallback(
    (entries: Array<{ id: string; bookId: string | null }>) => {
      void (async () => setAppData(await reorderPages(entries)))()
    },
    []
  )

  /**
   * 复习页改一条词汇卡。按拼写更新，全库同一个词/短语一起改。
   * grammar 是短语卡的「用法」那一格；单词卡不会传它。
   */
  const handleUpdateWord = useCallback(
    (word: string, updates: Partial<WordNote> & { grammar?: string }) => {
      const { word: _ignored, orphaned: _alsoIgnored, ...fields } = updates
      void (async () => setAppData(await updateVocabByText(word, fields)))()
    },
    []
  )

  const handleUpdateSentence = useCallback(
    (id: string, updates: Partial<Pick<Sentence, 'grammar' | 'meaning'>>) => {
      const target = (dataRef.current.annotations ?? []).find((a) => a.id === id)
      if (!target) return
      // 用户亲自改过，就不再算 AI 填的了 —— 标记本质是「待复核清单」
      const { auto: _wasAuto, ...rest } = target
      void (async () => setAppData(await saveAnnotation({ ...rest, ...updates })))()
    },
    []
  )

  const handleAcceptAgreement = useCallback(() => {
    try {
      localStorage.setItem(USER_AGREEMENT_KEY, 'accepted')
    } catch {
      // 若存储失败，也允许继续使用，但下次可能会再次弹出
    }
    setUserAgreementAccepted(true)
  }, [])

  const handleExitApp = useCallback(() => {
    if (Capacitor.isNativePlatform()) {
      CapacitorApp.exitApp()
    } else {
      window.close()
    }
  }, [])

  /**
   * 导入文件。具体怎么解析交给 src/importers 下的导入器，
   * 这里只负责「拿到结果 -> 写进库 -> 刷新界面」。
   */
  const handleImportFile = useCallback(
    (file: File) => {
      void (async () => {
        try {
          const result = await importFile(file)
          await addBookWithPages(result.bookName, result.chapters)
          await refreshData()
          if (!result.hasChapters) window.alert('未识别到章节，已导入为单文档')
        } catch (e) {
          window.alert('导入出错: ' + (e instanceof Error ? e.message : String(e)))
          await refreshData()
        }
      })()
    },
    [refreshData]
  )

  /** 够不够摆得下三栏。只用来分布局，手势那些全平台一套，见 useWideLayout */
  const isWide = useIsWide()
  const showLeft = activePanel === 'left'
  const showRight = activePanel === 'right'
  /*
    左栏此刻看不看得见。**宽窄两套收起机制合成的那一个答案** ——
    宽屏点汉堡改的是 wideLeftHidden，窄屏改的是 activePanel（见下面那颗键）。
    谁要判断「左栏开着没有」都从这里取，别自己拼，缘由见 isLeftSidebarVisible。
  */
  const leftVisible = isLeftSidebarVisible({
    isWide,
    wideLeftHidden,
    narrowPanelOpen: showLeft
  })

  const overlayVisible = showLeft || showRight

  /*
    沉浸阅读：顶栏（两条带）、两条系统栏、「笔记」键一起消失，正文占满整块屏。

    **宽窄两套触发方式**，条件抽在 shouldImmerse 里，那边有单独的测试：

    - 宽屏（平板横屏）：自动。两侧栏都收起来就进；点空白处顶栏露 3 秒又自己收
    - 窄屏（手机、平板竖屏）：手动。点空白处收起，不会自己回来，再点一下才回来

    窄屏那个开关的状态就在下面这一格。窄屏上侧栏本来就总是收着的，
    拿它当信号会变成一直沉浸；而且窄屏的顶栏是唯一的出口（侧栏、笔记都从那儿开），
    不能让它自作主张地消失 —— 所以那边只认手指。
  */
  const [narrowImmersive, setNarrowImmersive] = useState(false)
  const immersive = shouldImmerse({
    isWide,
    mode,
    editMode,
    leftHidden: wideLeftHidden,
    panelOpen: activePanel !== null,
    narrowOn: narrowImmersive
  })
  const { chromeVisible, toggleChrome } = useImmersiveReading(immersive)
  /** 此刻顶栏和「笔记」键是不是收着的 */
  const chromeHidden = immersive && !chromeVisible
  /** 「一键填充」：范围跟着当前复习的文档或文库走 */
  const autoFill = useAutoFill({
    appData,
    reviewTarget,
    writeAnnotation: useCallback(async (annotation) => {
      setAppData(await saveAnnotation(annotation))
    }, [])
  })

  /** 「一键划词」：只对当前打开的这一篇做 */
  const autoMark = useAutoMark({
    docId: currentPageId,
    docName: currentPage?.title || '这一篇',
    content: currentPage?.content ?? '',
    writeAnnotations: useCallback(async (list) => {
      setAppData(await addAnnotations(list))
    }, [])
  })

  /** 划完那条战报只属于它跑的那一篇 —— 翻到别的文档就该消失 */
  const markOutcome =
    autoMark.outcome && autoMark.outcome.docId === currentPageId ? autoMark.outcome : null

  const handleUndoMark = useCallback(
    (ids: string[]) => {
      void (async () => setAppData(await deleteAnnotations(ids)))()
      autoMark.dismissOutcome()
    },
    [autoMark]
  )


  return (
    <div className="h-full flex flex-col wide:flex-row bg-paper overflow-hidden">
      {/* 移动端遮罩：常驻并做透明度过渡，避免呼出侧栏时闪屏；点击同时关闭左/右侧栏 */}
      <div
        className={`fixed inset-0 z-20 wide:hidden bg-black/30 transition-opacity duration-200 ${
          overlayVisible ? 'opacity-100 pointer-events-auto' : 'opacity-0 pointer-events-none'
        }`}
        aria-hidden
        onClick={() => setActivePanel(null)}
      />

      {/*
        左侧栏：固定高度，内部独立滚动。

        **宽屏上也能收起来。** 从前是「窄屏能收、宽屏钉死」—— 汉堡键写着 md:hidden，
        一到宽屏就没了。平板上于是 250px 一直占着，想安静读书也收不掉。
        现在两边都能收，宽屏收起时用的是和右栏一样的办法：
        收起 = fixed + 移出屏幕（不占位置），展开 = relative（占一列），
        滑入滑出的动画两种宽度下都还在。

        `wideLeftHidden` 只在宽屏下有意义；窄屏一律看 showLeft（浮层那套）。
      */}
      <div
        className={`h-full flex flex-col shrink-0 ${showLeft ? 'fixed wide:relative' : 'fixed'} inset-y-0 left-0 z-30 wide:z-auto transform transition-transform duration-200 ease-out ${
          showLeft ? 'translate-x-0' : '-translate-x-full'
        } ${wideLeftHidden ? 'wide:fixed wide:-translate-x-full' : 'wide:relative wide:translate-x-0'}`}
      >
        <LeftSidebar
          width={isWide ? left.width : LEFT_WIDTH_DEFAULT}
          sidebarVisible={leftVisible}
          mode={mode}
          onModeChange={setMode}
          reviewTarget={reviewTarget}
          onReviewTargetChange={handleReviewTargetChange}
          books={activeBooks}
          pages={activePages}
          deletedBooks={deletedBooks}
          deletedPages={deletedPages}
          trashCount={trashCount}
          currentPageId={currentPageId}
          lastReadPages={lastReadPages}
          syncStatus={syncStatus}
          onSyncNow={syncManually}
          onAddBook={handleAddBook}
          onMoveBookToTrash={handleMoveBookToTrash}
          onMovePageToTrash={handleMovePageToTrash}
          onRestoreBook={handleRestoreBook}
          onRestorePage={handleRestorePage}
          onDeleteBookPermanently={handleDeleteBookPermanently}
          onDeletePagePermanently={handleDeletePagePermanently}
          onEmptyTrash={handleEmptyTrash}
          onRenameBook={handleRenameBook}
          onRenamePage={handleRenamePage}
          onSelectPage={handleSelectPage}
          onAddPage={handleAddPage}
          onExportBackup={exportBackup}
          onRestoreBackup={handleRestoreBackup}
          onReorderBooks={handleReorderBooks}
          onReorderPages={handleReorderPages}
          onImportFile={handleImportFile}
          readerSettings={readerSettings}
          onReaderSettingsChange={setReaderSettings}
        />

        {/*
          拖杆：左栏和正文的交界线，按住左右拖就能改左栏宽度。

          **只在宽屏、且左栏放出来时才有。** 窄屏那边左栏是盖住正文的浮层，
          拖宽了只会遮更多，没意义。

          自己看着是透明的，压在那条 1px 的分界线上；手指够得着的是 16px
          （比线宽得多，不然平板上按不准），按住时才显出一条强调色。
          `touch-none` 不能少 —— 不然手指一动浏览器当成滚动，把拖拽抢走了。
        */}
        {!wideLeftHidden && (
          <div
            role="separator"
            aria-orientation="vertical"
            aria-label="拖动改变文库栏宽度"
            className={`hidden wide:block absolute inset-y-0 -right-2 w-4 z-40 cursor-col-resize touch-none after:absolute after:inset-y-0 after:left-1/2 after:w-[2px] after:-translate-x-1/2 after:transition-colors ${
              left.dragging ? 'after:bg-accent-500' : 'after:bg-transparent hover:after:bg-accent-300'
            }`}
            {...left.handleProps}
          />
        )}
      </div>

      {/*
        右侧主区域：顶部栏 + 内容区（桌面端为 Column，避免 Header 与 Content 横向并列）。

        **顶部让出状态栏的那一下加在这里，不加在 header 上。** 三栏的第一条带是对齐过的
        （见 chrome.ts：44px，横着扫过去只有两条通栏的线）；留白要是加进 header 里，
        它会连着带子一起长高，而两侧栏的留白在带子外面 —— 三条线当场错开。
        加在带子外面，两边就都是「留白 + 44」。

        底色跟着刷成白的：这一条留白露出来的就是它，下面紧挨着的 header 也是白的，
        接在一起看不出缝。**底部不留系统栏** —— 正文的纸色要一直铺到屏幕最下沿，
        让出导航栏的事由滚动区里面的内容自己做（见 LyricEditor / VocabularyDashboard）。

        **键盘只在编辑全文时让**（`pb-[var(--kb)]`）。那种情况下输入框就是正文本身，
        不让开就看不见自己在打什么；其余时候（书库搜索、重命名、填 Key……）
        键盘只是盖住下半屏，正文没有理由跟着缩 —— 用户的原话：
        「除了编辑模式，没有必要任何情况下键盘出现都要顶起来吧」。
        第一版我不分场合地让，于是一开键盘正文底部就被吃掉一截。
      */}
      <div
        className={`relative flex flex-col flex-1 min-w-0 min-h-0 overflow-hidden bg-white ${
          // 沉浸时状态栏已经藏起来了，这条留白得跟着取消，否则顶上剩一道白边、就不是满屏。
          // 平时用的是 --sa-top-real（状态栏**本来**多高）而不是 --sa-top：
          // 退出沉浸那一瞬间系统栏还在路上，实时值这时是保底的 24，
          // 按它留位置会先长一截再长一截 —— 用户报过的「变宽然后再变宽一点」。
          immersive ? '' : 'pt-[var(--sa-top-real)]'
        } ${editMode ? 'pb-[var(--kb,0px)]' : ''}`}
      >
        {/*
          顶部栏。平时排在正文上面占一行；**沉浸态里改成浮在正文上面**。

          浮着是关键：沉浸时点一下空白处它就出来，3 秒后又收回去 —— 要是它还占着
          一行，每出来一次正文就被往下推一次、收回去再弹上来，读到哪儿都跟着跳。
          浮在上面则正文一动不动，和视频播放器的控制条是同一个道理。
          （容器那个 `relative` 就是为它加的。）

          沉浸态下藏起来的还有右边那颗「笔记」键，两样一起出没：
          汉堡键长在这条栏里，它不跟着出来，沉浸之后就没路再打开文库了。
        */}
        <div
          className={`shrink-0 bg-white ${
            immersive
              ? `absolute inset-x-0 top-0 z-20 pt-[var(--sa-top-real)] transition-opacity duration-200 ${
                  chromeVisible ? 'opacity-100' : 'opacity-0 pointer-events-none'
                }`
              : ''
          }`}
          aria-hidden={chromeHidden}
        >
        <header className={`${BAND_TOP} bg-white`}>
          {/*
            汉堡键在宽屏上也留着 —— 宽屏点它是「把左栏收起/放出来」，
            窄屏点它是「呼出浮层」。两种宽度下这颗键的含义一致：管左边那一栏。
          */}
          <button
            type="button"
            onClick={() => {
              if (isWide) setWideLeftHidden((v) => !v)
              else setActivePanel((p) => (p === 'left' ? null : 'left'))
            }}
            className="p-2 rounded-lg hover:bg-stone-100 text-ink-muted"
            aria-label={isWide && !wideLeftHidden ? '收起文库' : '打开文库'}
          >
            <Menu className="w-5 h-5" />
          </button>
          <span className="text-sm text-ink-muted truncate flex-1 min-w-0">
            {mode === 'review' && reviewVocabCount >= 0
              ? `${mobileHeaderTitle} (${reviewVocabCount})`
              : mobileHeaderTitle}
          </span>
          <button
            type="button"
            onClick={() => {
              if (mode === 'review') {
                setReviewEditMode((v) => !v)
              } else {
                setActivePanel((p) => (p === 'right' ? null : 'right'))
              }
            }}
            className={`p-2 rounded-lg ${mode === 'read' ? 'wide:hidden ' : ''}${
              mode === 'review' && reviewEditMode
                ? 'bg-accent-100 text-accent-800'
                : 'text-ink-muted hover:bg-stone-100'
            }`}
            aria-label={mode === 'review' ? '切换生词卡编辑模式' : '打开生词板'}
          >
            {mode === 'review' ? (
              <PenLine className="w-5 h-5" />
            ) : (
              <PanelRightOpen className="w-5 h-5" />
            )}
          </button>
        </header>
        </div>

        {/*
          中间区域：阅读模式 = 编辑器，复习模式 = 生词看板。

          **点中间收起笔记栏（只在宽屏）。** 窄屏那边点遮罩就能收，宽屏遮罩是隐藏的
          （三栏各占一列，正文不该被压暗），于是从前只剩笔记栏右上角那颗关闭键 ——
          用户在平板横屏上说「必须点右上角那个按钮，很麻烦」。现在有了这条路，
          那颗键也就删掉了（见 RightSidebar）。

          三种情况要放过去，不能顺手把栏收了：能操作的东西、正文里的英文词
          （长按取词松手时也会补一个 click）、以及取词小窗开着的时候
          —— 那一下归 LyricEditor 里那个全局 click 管，先关小窗。
        */}
        <main
          className="flex-1 flex flex-col min-w-0 min-h-0 overflow-hidden relative"
          onClick={(e) => {
            // 复习页和编辑全文里这一下什么都不做 —— 那两处沉浸本来就进不去，
            // 在那儿悄悄翻开关，等回到阅读页顶栏会莫名其妙地不见了
            if (mode !== 'read' || editMode) return
            const target = e.target as HTMLElement | null
            if (!target) return
            if (target.closest('button, a, input, textarea, select, label')) return
            if (target.closest('[data-word-span="true"]')) return
            if (document.querySelector('[data-full-popup="true"]')) return

            if (isWide) {
              // 笔记栏开着：这一下是「收起笔记栏」。收完往往正好进沉浸，那是下一次点的事
              if (activePanel === 'right') {
                setActivePanel(null)
                return
              }
              // 已经沉浸了：这一下是「把顶栏和笔记键叫出来 / 收回去」，3 秒后自己收
              if (immersive) toggleChrome()
              return
            }

            // 窄屏：这一下就是沉浸本身的开关，没有计时器，收起来就一直收着
            setNarrowImmersive((v) => !v)
          }}
        >
        {initializing && (
          <div className="flex-1 flex items-center justify-center text-ink-muted text-sm">
            数据加载中...
          </div>
        )}
        {!initializing && mode === 'read' && (
          <>
            {currentPage ? (
              <LyricEditor
                content={currentPage.content}
                pageId={currentPage.id}
                notes={notesForCurrent}
                sentences={sentencesForCurrent}
                onContentChange={handleContentChange}
                onNoteSave={handleNoteSave}
                onNoteDelete={handleNoteDelete}
                onAddSentence={handleAddSentence}
                onDeleteSentence={handleDeleteSentence}
                phrases={phrasesForCurrent}
                onAddPhrase={handleAddPhrase}
                onDeletePhrase={handleDeletePhrase}
                editMode={editMode}
                onEditModeChange={handleEditModeChange}
                savedProgress={currentPage.progress}
                onSaveProgress={handleSaveProgress}
                prevPage={prevPage}
                nextPage={nextPage}
                onSelectPage={handleSelectPageById}
                onReadingProgressChange={setDocumentReadingProgress}
                /*
                  笔记栏收起来（窄屏上滚正文时必然收着）或者在编辑模式，就整个不算 ——
                  给 undefined，阅读器那边一次都不会去遍历 <p>。
                */
                onLastVisibleAnchorChange={
                  showRight && !editMode ? setLastVisibleAnchor : undefined
                }
                readerSettings={readerSettings}
                immersive={immersive}
                chromeVisible={chromeVisible}
              />
            ) : (
              <div className="flex-1 flex items-center justify-center text-ink-muted">
                <p className="text-sm">在左侧新建文库并添加文档，或选择一篇开始学习</p>
              </div>
            )}
            {/*
              笔记栏呼出（宽屏才有）。

              **不能写成 `{!showRight && ...}`** —— 那样状态一翻转它就立刻冒出来，
              而侧栏还要滑 200ms 才走完，看着像它抢在前面跳出来。用户报的就是这个。
              改成一直挂着、用透明度收放：出现时**等 200ms**（侧栏滑完）再淡入，
              消失时不等，立刻让位给正在滑进来的侧栏。
            */}
            <button
              type="button"
              onClick={() => {
                setActivePanel('right')
              }}
              className={`hidden wide:flex fixed right-4 top-1/2 -translate-y-1/2 z-10 items-center gap-2 px-3 py-2 rounded-full border border-paper-border bg-white shadow-md hover:bg-accent-50 hover:border-accent-300 text-ink-muted hover:text-accent-800 transition-opacity ${
                showRight || chromeHidden
                  ? 'opacity-0 pointer-events-none duration-100'
                  : immersive
                    ? // 沉浸态里它跟着顶栏一起出没，不用等 —— 那 200ms 等的是侧栏
                      'opacity-100 duration-200'
                    : 'opacity-100 duration-150 delay-200'
              }`}
              title="打开笔记"
              aria-hidden={showRight || chromeHidden}
            >
              <BookOpen className="w-4 h-4" />
              <span className="text-sm font-medium">笔记</span>
            </button>
          </>
        )}
        {!initializing && mode === 'review' && (
          <VocabularyDashboard
            reviewTarget={reviewTarget}
            books={activeBooks.map((b) => ({ id: b.id, name: b.name }))}
            pages={activePages}
            annotations={annotations}
            isEditMode={reviewEditMode}
            onUpdateWord={handleUpdateWord}
            onUpdateSentence={handleUpdateSentence}
            onVocabCountChange={setReviewVocabCount}
            onDeleteAnnotation={handleDeleteAnnotationById}
            onOpenAutoFill={autoFill.openDialog}
            readerSettings={readerSettings}
            autoFillOpen={autoFill.open}
            autoFillCount={autoFill.pendingWords + autoFill.pendingPhrases + autoFill.pendingSentences}
          />
        )}
      </main>
      </div>

      {/*
        右侧栏：阅读模式下始终挂载（与左侧一致）。

        ## 宽窄两套出场方式，是为了消掉「打开时猛弹一下」

        用户 2026-09-07 报的：平板上每次打开笔记栏，正文会猛弹一下。
        量出来的成因是**两件事不同步**：

        | | 关着 | 开着 | 怎么变 |
        |---|---|---|---|
        | 正文宽 | 1030 | 680 | **瞬间**（没有过渡） |
        | 笔记栏 | 屏幕外 | 就位 | 200ms 滑入 |

        从前宽屏靠 `fixed -> wide:relative` 切换来占位：那一下是布局跳变、
        没有动画，而面板还在慢慢滑进来。正文一帧之内窄 350px、整篇重新折行，
        看着就是「弹」。歌词行短不折行所以看不出来，**书里一段占好几屏，
        他那儿特别明显**。

        现在宽屏**一直是 relative**，改成动画它自己的**宽度** 0 ↔ N。
        正文是 flex-1，宽度跟着一起平滑变，两边同步了。
        里层那个盒子锁着完整宽度并 `overflow-hidden`，所以内容不会被压扁 ——
        外框变宽时内容从右边露出来，滑入感还在。

        窄屏那套一个字没动：还是 `fixed` + translate 浮层。
      */}
      {mode === 'read' && (
        <div
          className={`h-full flex shrink-0 fixed wide:relative inset-y-0 right-0 z-30 wide:z-auto transform transition-transform duration-200 ease-out ${
            showRight ? 'translate-x-0' : 'translate-x-full'
          } wide:translate-x-0`}
        >
          {/*
            中间这层管两件事：**宽度动画**（推着正文一起平滑变）和**裁剪**。
            外层不能裁 —— 拖杆在它左边缘外面（-left-2），裁了就没了。
          */}
          <div
            className="h-full shrink-0 overflow-hidden wide:transition-[width] wide:duration-200 wide:ease-out"
            style={isWide ? { width: showRight ? right.width : 0 } : undefined}
          >
            {/* 里层锁住完整宽度，外面变窄时内容不跟着压扁，而是被裁掉 */}
            <div
              className="h-full flex flex-col"
              style={isWide ? { width: right.width } : undefined}
            >
          <RightSidebar
            width={isWide ? right.width : RIGHT_WIDTH_NARROW}
            vocab={vocabList}
            sentences={sentences}
            onScrollToWord={handleScrollToWord}
            onScrollToSentence={handleScrollToSentence}
            onAutoMark={currentPageId ? autoMark.openDialog : undefined}
            autoMarkOpen={autoMark.open}
            markOutcome={markOutcome}
            onUndoMark={handleUndoMark}
            onDismissMark={autoMark.dismissOutcome}
            onDeleteVocab={handleDeleteVocabNote}
            onDeleteSentence={handleDeleteSentenceById}
            currentPageId={currentPageId}
            documentProgress={documentReadingProgress}
            open={showRight}
            lastVisibleAnchor={lastVisibleAnchor}
            savedNoteFocus={savedNoteFocus}
            currentDocIndex={currentDocIndex}
            totalDocsInFolder={totalDocsInFolder}
          />
            </div>
          </div>

          {/*
            拖杆：正文和笔记栏的交界线。和左栏那根是同一套（usePanelWidth），
            只是杆在这一栏的**左**边缘，所以往左拖才是变宽（invert）。

            只在宽屏、且笔记栏开着时才有 —— 收起来的时候那条边在屏幕外面。
          */}
          {showRight && (
            <div
              role="separator"
              aria-orientation="vertical"
              aria-label="拖动改变笔记栏宽度"
              className={`hidden wide:block absolute inset-y-0 -left-2 w-4 z-40 cursor-col-resize touch-none after:absolute after:inset-y-0 after:left-1/2 after:w-[2px] after:-translate-x-1/2 after:transition-colors ${
                right.dragging ? 'after:bg-accent-500' : 'after:bg-transparent hover:after:bg-accent-300'
              }`}
              {...right.handleProps}
            />
          )}
        </div>
      )}

      {/* 用户协议与版权声明：首次启动未同意时全屏弹窗 */}
      <AutoFillDialog
        open={autoFill.open}
        pendingWords={autoFill.pendingWords}
        pendingPhrases={autoFill.pendingPhrases}
        pendingSentences={autoFill.pendingSentences}
        scopeName={autoFill.scopeName}
        state={autoFill.state}
        onStart={autoFill.start}
        onCancel={autoFill.cancel}
        onClose={autoFill.closeDialog}
      />

      {/* 一键划词：从阅读页的生词板顶上进来，只对当前这一篇做 */}
      <AutoMarkDialog
        open={autoMark.open}
        docName={autoMark.docName}
        state={autoMark.state}
        onStart={autoMark.start}
        onCancel={autoMark.cancel}
        onClose={autoMark.closeDialog}
      />

      {/* 「原文已删除」确认弹窗：沿用用户协议那张居中卡片的样式 */}
      {orphanPrompt && (
        <div className="fixed inset-0 z-[100] flex items-center justify-center bg-black/40 p-4 kb-safe">
          <div className="max-w-sm w-[90%] max-h-[85vh] overflow-y-auto bg-white rounded-2xl shadow-xl border border-paper-border p-4 space-y-3">
            <h2 className="text-base font-semibold text-ink text-center mb-1">原文已删除</h2>
            <p className="text-xs text-ink-muted leading-relaxed">
              下面这些笔记，在正文里已经找不到对应内容了：
            </p>

            <div className="space-y-2 max-h-[40vh] overflow-y-auto">
              {orphanPrompt.words.length > 0 && (
                <div className="rounded-lg bg-stone-50 border border-paper-border p-2.5">
                  <p className="text-xs text-ink-muted mb-1.5">单词</p>
                  <div className="flex flex-wrap gap-1.5">
                    {orphanPrompt.words.map((w) => (
                      <span
                        key={w}
                        className="font-lyric-en font-serif text-accent-800 font-semibold text-sm px-2 py-0.5 rounded-full bg-white border border-stone-200"
                      >
                        {w}
                      </span>
                    ))}
                  </div>
                </div>
              )}

              {orphanPrompt.sentences.length > 0 && (
                <div className="rounded-lg bg-stone-50 border border-paper-border p-2.5">
                  <p className="text-xs text-ink-muted mb-1.5">句子</p>
                  <ul className="space-y-1.5">
                    {orphanPrompt.sentences.map((s) => (
                      <li key={s.id} className="font-serif text-sm text-ink leading-snug line-clamp-2">
                        {s.text}
                      </li>
                    ))}
                  </ul>
                </div>
              )}
            </div>

            <p className="text-xs text-ink-muted leading-relaxed">
              选择保留的话，它们会留在生词表里，并标记为「原文已删除」；
              以后不会再提示你，若原文中重新出现该内容会自动恢复。
            </p>

            <div className="flex gap-2 pt-1">
              <button
                type="button"
                className="flex-1 h-9 rounded-lg border border-stone-300 text-stone-600 text-sm hover:bg-stone-50"
                onClick={() => closeOrphanPrompt(false)}
              >
                保留
              </button>
              <button
                type="button"
                className="flex-1 h-9 rounded-lg bg-accent-600 hover:bg-accent-700 text-white text-sm font-medium"
                onClick={() => closeOrphanPrompt(true)}
              >
                一并删除
              </button>
            </div>
          </div>
        </div>
      )}

      {agreementChecked && !userAgreementAccepted && (
        <div className="fixed inset-0 z-[100] flex items-center justify-center bg-black/40 p-4 kb-safe">
          <div className="max-w-sm w-[90%] max-h-[85vh] overflow-y-auto bg-white rounded-2xl shadow-xl border border-paper-border p-4 space-y-3 text-sm leading-relaxed">
            <h2 className="text-base font-semibold text-ink text-center mb-1">{AGREEMENT_TITLE}</h2>
            {/* 正文收在 agreement.ts 里，和设置页「关于」里那份是同一份 */}
            <div className="space-y-2 text-ink-muted text-xs">
              {AGREEMENT_CLAUSES.map((line) => (
                <p key={line}>{line}</p>
              ))}
            </div>
            <div className="flex gap-2 pt-2">
              <button
                type="button"
                className="flex-1 h-9 rounded-lg border border-stone-300 text-stone-600 text-sm hover:bg-stone-50"
                onClick={handleExitApp}
              >
                退出
              </button>
              <button
                type="button"
                className="flex-1 h-9 rounded-lg bg-accent-600 hover:bg-accent-700 text-white text-sm font-medium"
                onClick={handleAcceptAgreement}
              >
                同意
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
