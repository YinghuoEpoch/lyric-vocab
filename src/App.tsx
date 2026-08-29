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
  Annotation,
  AnnotationGroup,
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
import { useBackHandler, handleBackPress, BackPriority } from './hooks/useBackHandler'
import { useAutoFill } from './hooks/useAutoFill'
import { AutoFillDialog } from './components/AutoFillDialog'
import {
  getAppData,
  replaceAllData,
  saveBook,
  savePage,
  moveBookToTrash,
  movePageToTrash,
  restoreBook,
  restorePage,
  deleteBookPermanently,
  deletePagePermanently,
  generateId,
  reorderBooks,
  reorderPages,
  addBookWithPages,
  replacePageNotes,
  saveAnnotation,
  deleteAnnotation,
  replaceDocAnnotations,
  updateAnnotationsByWord,
  orderForNewAnnotation,
  reorderAnnotations,
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
const defaultReaderSettings: ReaderSettings = {
  fontSize: 18,
  fontFamily: 'sans',
  theme: 'pure'
}

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
      theme
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
  const [activePanel, setActivePanel] = useState<ActivePanel>(null)
  const [scrollTarget, setScrollTarget] = useState<{ pageId: string; anchorId: string } | null>(null)
  const [pendingSentenceEdit, setPendingSentenceEdit] = useState<Sentence | null>(null)
  /** 「原文已删除」确认弹窗；resolve 用于把用户的选择交回给对账流程 */
  const [orphanPrompt, setOrphanPrompt] = useState<{
    words: string[]
    sentences: Sentence[]
    resolve: (shouldDelete: boolean) => void
  } | null>(null)
  const [documentReadingProgress, setDocumentReadingProgress] = useState(0)
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

  const exportBackup = useExportBackup()

  const refreshData = useCallback(async () => {
    try {
      const data = await getAppData()
      setAppData(data)
    } catch {
      // 读取失败时保持现有内存数据
    }
  }, [])

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

  /** 移动端顶部栏标题：阅读模式=当前文档名，复习模式=选中的文档名或文件夹名 */
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
    // 如果当前有 pendingSentenceEdit，延迟清空它（等待滚动和弹窗打开完成）
    if (pendingSentenceEdit) {
      setTimeout(() => {
        setPendingSentenceEdit(null)
      }, 500)
    }
  }, [scrollTarget, currentPageId, pendingSentenceEdit])

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

  const handleSaveProgress = useCallback(
    (scrollTop: number) => {
      if (!currentPage) return
      void (async () => {
        await savePage({ ...currentPage, progress: scrollTop })
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
              order: orderForNewAnnotation(latest, currentPageId, 'vocab', anchorId),
              createdAt: Date.now(),
              ...fields
            }
        // 用户亲手写的，就不再算 AI 填的 —— 那个标记本质是「待复核清单」
        delete next.auto
        setAppData(await saveAnnotation(next))
      })()
    },
    [currentPageId]
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
   * 注意：一旦接管了返回键，系统默认的「退出 App」就不会再发生，
   * 所以没东西可关时必须自己调 exitApp，否则在主界面按返回会毫无反应。
   */
  useEffect(() => {
    if (!Capacitor.isNativePlatform()) return
    let handle: PluginListenerHandle | undefined
    let cancelled = false

    void CapacitorApp.addListener('backButton', () => {
      if (!handleBackPress()) CapacitorApp.exitApp()
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
              order: orderForNewAnnotation(latest, s.docId, 'sentence', s.startAnchorId),
              createdAt: Date.now(),
              grammar: s.grammar,
              meaning: s.meaning
            }
        delete next.auto // 用户亲手写的，不再算 AI 填的
        setAppData(await saveAnnotation(next))
      })()
    },
    []
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
              // 和单词同一条队：复习页里它们是同一列卡片
              order: orderForNewAnnotation(latest, p.docId, 'vocab', p.startAnchorId),
              createdAt: Date.now(),
              definition: p.definition,
              grammar: p.usage
            }
        delete next.auto // 用户亲手写的，不再算 AI 填的
        setAppData(await saveAnnotation(next))
      })()
    },
    []
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

  const handleScrollToWord = useCallback((pageId: string, anchorId: string) => {
    setScrollTarget({ pageId, anchorId })
    setActivePanel(null)
  }, [])

  const handleEditSentence = useCallback((sentence: Sentence) => {
    // 1. 设置滚动目标（使用句子的起始 anchorId）
    setScrollTarget({ pageId: sentence.docId, anchorId: sentence.startAnchorId })
    // 2. 关闭右侧栏
    setActivePanel(null)
    // 3. 设置"待编辑的句子"状态，供 LyricEditor 使用
    setPendingSentenceEdit(sentence)
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
      void (async () => setAppData(await updateAnnotationsByWord(word, fields)))()
    },
    []
  )

  /** 复习页拖拽调整卡片顺序。排序逻辑只在存储层实现一份，这里拿结果直接更新界面 */
  const handleReorderCards = useCallback(
    (docId: string, group: AnnotationGroup, ids: string[]) => {
      void (async () => setAppData(await reorderAnnotations(docId, group, ids)))()
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

  const showLeft = activePanel === 'left'
  const showRight = activePanel === 'right'

  const overlayVisible = showLeft || showRight
  /** 「一键填充」：范围跟着当前复习的文档或文库走 */
  const autoFill = useAutoFill({
    appData,
    reviewTarget,
    writeAnnotation: useCallback(async (annotation) => {
      setAppData(await saveAnnotation(annotation))
    }, [])
  })


  return (
    <div className="h-full flex flex-col md:flex-row bg-paper overflow-hidden">
      {/* 移动端遮罩：常驻并做透明度过渡，避免呼出侧栏时闪屏；点击同时关闭左/右侧栏 */}
      <div
        className={`fixed inset-0 z-20 md:hidden bg-black/30 transition-opacity duration-200 ${
          overlayVisible ? 'opacity-100 pointer-events-auto' : 'opacity-0 pointer-events-none'
        }`}
        aria-hidden
        onClick={() => setActivePanel(null)}
      />

      {/* 左侧栏：固定高度，内部独立滚动 */}
      <div
        className={`h-full flex flex-col shrink-0 fixed md:relative inset-y-0 left-0 z-30 md:z-auto transform transition-transform duration-200 ease-out ${
          showLeft ? 'translate-x-0' : '-translate-x-full md:translate-x-0'
        }`}
      >
        <LeftSidebar
          panelOpen={showLeft}
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
          onAddBook={handleAddBook}
          onMoveBookToTrash={handleMoveBookToTrash}
          onMovePageToTrash={handleMovePageToTrash}
          onRestoreBook={handleRestoreBook}
          onRestorePage={handleRestorePage}
          onDeleteBookPermanently={handleDeleteBookPermanently}
          onDeletePagePermanently={handleDeletePagePermanently}
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
      </div>

      {/* 右侧主区域：顶部栏 + 内容区（桌面端为 Column，避免 Header 与 Content 横向并列） */}
      <div className="flex flex-col flex-1 min-w-0 min-h-0 overflow-hidden">
        {/* 顶部栏：始终显示；桌面端仅保留标题与复习模式下的编辑按钮 */}
        <header className="shrink-0 flex items-center gap-2 px-3 py-2 border-b border-gray-200 bg-white">
          <button
            type="button"
            onClick={() => setActivePanel((p) => (p === 'left' ? null : 'left'))}
            className="md:hidden p-2 rounded-lg hover:bg-stone-100 text-ink-muted"
            aria-label="打开文库"
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
            className={`p-2 rounded-lg ${mode === 'read' ? 'md:hidden ' : ''}${
              mode === 'review' && reviewEditMode
                ? 'bg-amber-100 text-amber-800'
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

        {/* 中间区域：阅读模式 = 编辑器，复习模式 = 生词看板 */}
        <main className="flex-1 flex flex-col min-w-0 min-h-0 overflow-hidden relative">
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
                pendingSentenceEdit={pendingSentenceEdit}
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
                readerSettings={readerSettings}
              />
            ) : (
              <div className="flex-1 flex items-center justify-center text-ink-muted">
                <p className="text-sm">在左侧新建文库并添加文档，或选择一篇开始学习</p>
              </div>
            )}
            {/* 笔记栏呼出：仅阅读模式且右侧关闭时显示 */}
            {!showRight && (
              <button
                type="button"
                onClick={() => {
                  setActivePanel('right')
                }}
                className="hidden md:flex fixed right-4 top-1/2 -translate-y-1/2 z-10 items-center gap-2 px-3 py-2 rounded-full border border-paper-border bg-white shadow-md hover:bg-amber-50 hover:border-amber-300 text-ink-muted hover:text-amber-800 transition-colors"
                title="打开笔记"
              >
                <BookOpen className="w-4 h-4" />
                <span className="text-sm font-medium">笔记</span>
              </button>
            )}
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
            onReorder={handleReorderCards}
            onVocabCountChange={setReviewVocabCount}
            onOpenAutoFill={autoFill.openDialog}
            autoFillCount={autoFill.pendingWords + autoFill.pendingPhrases + autoFill.pendingSentences}
          />
        )}
      </main>
      </div>

      {/* 右侧栏：阅读模式下始终挂载（与左侧一致），用 showRight 控制 translate 才能稳定播滑入/滑出动画 */}
      {mode === 'read' && (
        <div
          className={`h-full flex flex-col shrink-0 ${showRight ? 'fixed md:relative' : 'fixed'} inset-y-0 right-0 z-30 md:z-auto transform transition-transform duration-200 ease-out ${
            showRight ? 'translate-x-0' : 'translate-x-full'
          }`}
        >
          <RightSidebar
            vocab={vocabList}
            sentences={sentences}
            onScrollToWord={handleScrollToWord}
            onEditSentence={handleEditSentence}
            onDeleteVocab={handleDeleteVocabNote}
            onDeleteSentence={handleDeleteSentenceById}
            currentPageId={currentPageId}
            onClose={() => setActivePanel(null)}
            documentProgress={documentReadingProgress}
            currentDocIndex={currentDocIndex}
            totalDocsInFolder={totalDocsInFolder}
          />
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

      {/* 「原文已删除」确认弹窗：沿用用户协议那张居中卡片的样式 */}
      {orphanPrompt && (
        <div className="fixed inset-0 z-[100] flex items-center justify-center bg-black/40 p-4">
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
                        className="font-lyric-en font-serif text-amber-800 font-semibold text-sm px-2 py-0.5 rounded-full bg-white border border-stone-200"
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
                className="flex-1 h-9 rounded-lg bg-amber-600 hover:bg-amber-700 text-white text-sm font-medium"
                onClick={() => closeOrphanPrompt(true)}
              >
                一并删除
              </button>
            </div>
          </div>
        </div>
      )}

      {agreementChecked && !userAgreementAccepted && (
        <div className="fixed inset-0 z-[100] flex items-center justify-center bg-black/40 p-4">
          <div className="max-w-sm w-[90%] max-h-[85vh] overflow-y-auto bg-white rounded-2xl shadow-xl border border-paper-border p-4 space-y-3 text-sm leading-relaxed">
            <h2 className="text-base font-semibold text-ink text-center mb-1">用户协议与版权声明</h2>
            <div className="space-y-2 text-ink-muted text-xs">
              <p>1. 本软件由 荧惑纪 独立开发，版权所有 © 2026。</p>
              <p>2. 本软件仅供个人非商业用途（学习、交流、研究）使用。</p>
              <p>3. 未经作者书面授权，严禁任何形式的商业使用，包括但不限于：打包售卖、植入广告、会员收费、或将其作为其他商业产品的一部分。</p>
              <p>4. 严禁对本软件进行反向工程、反编译、反汇编，或试图通过任何方式获取源代码。</p>
              <p>5. 点击“同意”即表示您已阅读并接受上述条款。如不同意，请立即退出并卸载本软件。</p>
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
                className="flex-1 h-9 rounded-lg bg-amber-600 hover:bg-amber-700 text-white text-sm font-medium"
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
