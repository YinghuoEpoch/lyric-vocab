import { useState, useCallback, useEffect, useMemo, useRef } from 'react'
import { Capacitor } from '@capacitor/core'
import { App as CapacitorApp } from '@capacitor/app'
import { Menu, PanelRightOpen, BookOpen, PenLine } from 'lucide-react'
import { LeftSidebar } from './components/LeftSidebar'
import { RightSidebar } from './components/RightSidebar'
import { LyricEditor } from './components/LyricEditor'
import { VocabularyDashboard } from './components/VocabularyDashboard'
import { useExportBackup } from './hooks/useExportBackup'
import type { AppData, LyricBook, LyricPage, ReaderSettings, Sentence, WordNote } from './types'
import { SAMPLE_PAGE_ID, SAMPLE_SENTENCES } from './sampleData'
import { reconcilePage } from './utils/reconcile'
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
  deleteNoteForPage,
  saveNoteForPage,
  generateId,
  reorderBooks,
  reorderPages,
  updateWordEverywhere,
  addBookWithPages,
  replacePageNotes
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

export default function App() {
  const [appData, setAppData] = useState<AppData>({
    books: [],
    pages: [],
    notes: {}
  })
  const [initializing, setInitializing] = useState(true)
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
  const [documentReadingProgress, setDocumentReadingProgress] = useState(0)
  const [reviewVocabCount, setReviewVocabCount] = useState(0)
  const [readerSettings, setReaderSettings] = useState<ReaderSettings>(loadReaderSettings)
  const [sentences, setSentences] = useState<Sentence[]>(() => {
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
  })

  useEffect(() => {
    try {
      localStorage.setItem(SENTENCES_KEY, JSON.stringify(sentences))
    } catch {
      // ignore
    }
  }, [sentences])

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

  // 使用示例文档且当前没有任何句摘时，自动注入示例句摘（Is to wish my life away）
  const hasSamplePage = useMemo(
    () => appData.pages.some((p) => p.id === SAMPLE_PAGE_ID),
    [appData.pages]
  )
  useEffect(() => {
    if (!hasSamplePage || sentences.length > 0) return
    setSentences(SAMPLE_SENTENCES)
  }, [hasSamplePage, sentences.length])

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
    () => (currentPageId ? (appData.notes[currentPageId] ?? {}) : {}),
    [appData.notes, currentPageId]
  )

  const sentencesForCurrent = useMemo(
    () => (currentPageId ? sentences.filter((s) => s.docId === currentPageId) : []),
    [sentences, currentPageId]
  )

  const vocabList = useMemo(() => {
    const activePageIds = new Set(activePages.map((p) => p.id))
    const out: Array<{
      word: string
      anchorId: string
      pageId: string
      phonetic?: string
      pos?: string
      definition?: string
      orphaned?: boolean
    }> = []
    for (const pageId of Object.keys(appData.notes)) {
      if (!activePageIds.has(pageId)) continue
      const map = appData.notes[pageId]
      for (const anchorId of Object.keys(map)) {
        const n = map[anchorId]
        if (n?.word)
          out.push({
            word: n.word,
            anchorId,
            pageId,
            phonetic: n.phonetic,
            pos: n.pos,
            definition: n.definition,
            orphaned: n.orphaned
          })
      }
    }
    return out
  }, [appData.notes, activePages])

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

  const handleNoteSave = useCallback(
    (anchorId: string, note: WordNote) => {
      if (!currentPageId) return
      void (async () => {
        await saveNoteForPage(currentPageId, anchorId, note)
        await refreshData()
      })()
    },
    [currentPageId, refreshData]
  )

  const handleNoteDelete = useCallback(
    (anchorId: string) => {
      if (!currentPageId) return
      void (async () => {
        await deleteNoteForPage(currentPageId, anchorId)
        await refreshData()
      })()
    },
    [currentPageId, refreshData]
  )

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
      const pageNotes = data.notes[pageId] ?? {}
      const pageSentences = sentences.filter((s) => s.docId === pageId)
      if (Object.keys(pageNotes).length === 0 && pageSentences.length === 0) return

      const result = reconcilePage(oldContent, newContent, pageNotes, pageSentences)
      if (!result.changed) return

      let notesToWrite = result.notes
      let sentencesToKeep = result.sentences

      const orphanWords = result.newOrphanNotes.map((n) => n.word).filter(Boolean)
      const hasOrphans = result.newOrphanNotes.length > 0 || result.newOrphanSentences.length > 0

      if (hasOrphans) {
        const parts: string[] = ['以下笔记对应的原文已经不在文中了：\n']
        if (orphanWords.length > 0) parts.push(`单词：${orphanWords.join('、')}`)
        for (const s of result.newOrphanSentences) {
          const preview = s.text.length > 30 ? `${s.text.slice(0, 30)}…` : s.text
          parts.push(`句子：「${preview}」`)
        }
        parts.push('\n是否一并删除这些笔记？\n点「取消」则保留，并在生词表里标记为「原文已删除」。')

        if (!window.confirm(parts.join('\n'))) {
          // 用户选择保留：留在原坐标上并打标记。
          // 打了标记之后，以后每次对账都不会再拿它来打扰用户；
          // 若哪天原文里又出现这个词，会自动重新挂上并清掉标记。
          notesToWrite = { ...result.notes }
          for (const orphan of result.newOrphanNotes) {
            const original = pageNotes[orphan.anchorId]
            if (original && !notesToWrite[orphan.anchorId]) {
              notesToWrite[orphan.anchorId] = { ...original, orphaned: true }
            }
          }
          sentencesToKeep = [
            ...result.sentences,
            ...result.newOrphanSentences.map((s) => ({ ...s, orphaned: true }))
          ]
        }
      }

      setAppData(await replacePageNotes(pageId, notesToWrite))
      setSentences((prev) => [...prev.filter((s) => s.docId !== pageId), ...sentencesToKeep])
    },
    [sentences]
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
    if (initializing || recoveredRef.current) return
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
  }, [initializing, appData.pages, reconcileAfterEdit])

  const handleAddSentence = useCallback(
    (s: {
      text: string
      grammar: string
      meaning: string
      docId: string
      startAnchorId: string
      endAnchorId: string
    }) => {
      setSentences((prev) => [
        ...prev,
        {
          ...s,
          id: generateId(),
          date: Date.now()
        }
      ])
    },
    []
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
      setSentences((prev) =>
        prev.filter(
          (s) =>
            !(
              s.docId === currentPageId &&
              s.startAnchorId === startAnchorId &&
              s.endAnchorId === endAnchorId
            )
        )
      )
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

  const handleUpdateWord = useCallback(
    (word: string, updates: Partial<WordNote>) => {
      void (async () => {
        await updateWordEverywhere(word, updates)
        await refreshData()
      })()
    },
    [refreshData]
  )

  const handleUpdateSentence = useCallback((id: string, updates: Partial<Pick<Sentence, 'grammar' | 'meaning'>>) => {
    setSentences((prev) =>
      prev.map((s) => (s.id === id ? { ...s, ...updates, date: Date.now() } : s))
    )
  }, [])

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

  const handleImportTxt = useCallback(
    (file: File) => {
      const baseName = file.name.replace(/\.txt$/i, '') || '导入文本'

      // 支持：中文第N章/回/节/卷/集/部；Chapter 后任意内容；宽间距 C H A P T E R 后任意内容；Session N
      const CHAPTER_REGEX =
        /^\s*(?:第\s*[0-9零一二三四五六七八九十百千]+\s*[章回节卷集部]|Chapter\s+.*|C\s*H\s*A\s*P\s*T\s*E\s*R\s+.*|Session\s+\d+|###\s*.*|Part\s+.*).*$/gim

      const buildSections = (raw: string): { sections: Array<{ title: string; content: string }>; hasChapters: boolean } => {
        const normalized = (raw ?? '').replace(/\r\n/g, '\n')
        const chapters: Array<{ title: string; content: string }> = []
        const regex = new RegExp(CHAPTER_REGEX.source, 'gim')

        let currentTitle: string | null = null
        let lastIndex = 0
        let match: RegExpExecArray | null

        while ((match = regex.exec(normalized)) !== null) {
          const header = match[0].trim()
          const start = match.index

          if (currentTitle !== null) {
            const body = normalized.slice(lastIndex, start).trim()
            if (body) {
              chapters.push({ title: currentTitle, content: body })
            }
          }

          currentTitle = header
          lastIndex = regex.lastIndex
        }

        if (currentTitle !== null) {
          const body = normalized.slice(lastIndex).trim()
          if (body) {
            chapters.push({ title: currentTitle, content: body })
          }
        }

        if (chapters.length === 0) {
          return {
            sections: [{ title: baseName, content: normalized }],
            hasChapters: false
          }
        }

        return { sections: chapters, hasChapters: true }
      }

      const readAsText = (encoding: string): Promise<string> =>
        new Promise((resolve, reject) => {
          const reader = new FileReader()
          reader.onload = () => resolve((reader.result ?? '') as string)
          reader.onerror = () => reject(reader.error ?? new Error('FileReader failed'))
          reader.readAsText(file, encoding)
        })

      const runImport = () => {
        readAsText('utf-8')
          .then((utf8Text) => {
            try {
              const utf8Result = buildSections(utf8Text)
              if (utf8Result.hasChapters) {
                void (async () => {
                  await addBookWithPages(baseName, utf8Result.sections)
                  await refreshData()
                })()
                return
              }

              readAsText('gbk').then((gbkText) => {
                try {
                  const gbkResult = buildSections(gbkText)
                  if (gbkResult.hasChapters) {
                    void (async () => {
                      await addBookWithPages(baseName, gbkResult.sections)
                      await refreshData()
                    })()
                    return
                  }

                  void (async () => {
                    await addBookWithPages(baseName, utf8Result.sections)
                    await refreshData()
                    window.alert('未识别到章节，已导入为单文档')
                  })()
                } catch (e) {
                  const msg = e instanceof Error ? e.message : String(e)
                  window.alert('导入出错: ' + msg)
                  refreshData()
                }
              }).catch(() => {
                void (async () => {
                  await addBookWithPages(baseName, utf8Result.sections)
                  await refreshData()
                  window.alert('未识别到章节，已导入为单文档')
                })()
              })
            } catch (e) {
              const msg = e instanceof Error ? e.message : String(e)
              window.alert('导入出错: ' + msg)
              refreshData()
            }
          })
          .catch((e) => {
            const msg = e instanceof Error ? e.message : String(e)
            window.alert('导入出错: ' + msg)
            void refreshData()
          })
      }

      runImport()
    },
    [refreshData]
  )

  const showLeft = activePanel === 'left'
  const showRight = activePanel === 'right'

  const overlayVisible = showLeft || showRight
  const VocabularyDashboardAny = VocabularyDashboard as any

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
          onRestoreBackup={(file) => {
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

                  // 再尝试恢复句摘（Sentence）到 localStorage + 内存状态
                  if (Array.isArray(data.sentences)) {
                    const restoredSentences = data.sentences.filter(
                      (x: unknown): x is Sentence =>
                        typeof x === 'object' &&
                        x !== null &&
                        typeof (x as Sentence).id === 'string' &&
                        typeof (x as Sentence).text === 'string' &&
                        typeof (x as Sentence).docId === 'string' &&
                        typeof (x as Sentence).date === 'number'
                    )
                    try {
                      localStorage.setItem(SENTENCES_KEY, JSON.stringify(restoredSentences))
                    } catch {
                      // 如果写入失败，不阻塞主数据恢复
                    }
                    setSentences(restoredSentences)
                  }

                  setCurrentPageId(null)
                } catch (e) {
                  const msg = e instanceof Error ? e.message : String(e)
                  window.alert('恢复备份失败: ' + msg)
                }
              })()
            }
            reader.readAsText(file)
          }}
          onReorderBooks={handleReorderBooks}
          onReorderPages={handleReorderPages}
          onImportTxt={handleImportTxt}
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
                editMode={editMode}
                onEditModeChange={handleEditModeChange}
                savedProgress={currentPage.progress}
                onSaveProgress={handleSaveProgress}
                prevPage={prevPage}
                nextPage={nextPage}
                onSelectPage={(pageId) => {
                  setCurrentPageId(pageId)
                  setActivePanel(null)
                }}
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
          <VocabularyDashboardAny
            reviewTarget={reviewTarget}
            books={activeBooks.map((b) => ({ id: b.id, name: b.name }))}
            pages={activePages}
            notes={appData.notes}
            sentences={sentences}
            isEditMode={reviewEditMode}
            onUpdateWord={handleUpdateWord}
            onUpdateSentence={handleUpdateSentence}
            onVocabCountChange={setReviewVocabCount}
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
            setSentences={setSentences}
            onScrollToWord={handleScrollToWord}
            onEditSentence={handleEditSentence}
            currentPageId={currentPageId}
            onClose={() => setActivePanel(null)}
            documentProgress={documentReadingProgress}
            currentDocIndex={currentDocIndex}
            totalDocsInFolder={totalDocsInFolder}
          />
        </div>
      )}

      {/* 用户协议与版权声明：首次启动未同意时全屏弹窗 */}
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
