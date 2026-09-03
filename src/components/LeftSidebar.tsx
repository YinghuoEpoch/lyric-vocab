import { memo, useState, useCallback, useRef, useEffect } from 'react'
import {
  FolderPlus,
  FileText,
  Library,
  Book,
  BookOpen,
  Brain,
  MoreHorizontal,
  Plus,
  Pencil,
  Trash2,
  RotateCcw,
  X,
  ChevronRight,
  GripVertical,
  Settings
} from 'lucide-react'
import {
  DndContext,
  DragOverlay,
  closestCorners,
  DragEndEvent,
  DragStartEvent,
  DragOverEvent,
  PointerSensor,
  useSensor,
  useSensors
} from '@dnd-kit/core'
import type { Modifier } from '@dnd-kit/core'
import {
  SortableContext,
  verticalListSortingStrategy,
  useSortable
} from '@dnd-kit/sortable'
import { restrictToVerticalAxis, restrictToWindowEdges } from '@dnd-kit/modifiers'
import { CSS } from '@dnd-kit/utilities'
import { createPortal } from 'react-dom'
import { SettingsDialog } from './SettingsDialog'
import { LibraryDialog } from './LibraryDialog'
import { useBackHandler, BackPriority } from '../hooks/useBackHandler'
import { IMPORT_ACCEPT } from '../importers'
import { BAND_TOP, BAND_SUB } from './chrome'
import type { LyricBook, LyricPage, ReaderSettings } from '../types'

export type AppMode = 'read' | 'review'
export type ReviewTarget = { type: 'book'; id: string } | { type: 'page'; id: string } | null

interface LeftSidebarProps {
  mode: AppMode
  onModeChange: (mode: AppMode) => void
  reviewTarget: ReviewTarget
  onReviewTargetChange: (target: ReviewTarget) => void
  books: LyricBook[]
  pages: LyricPage[]
  deletedBooks: LyricBook[]
  deletedPages: LyricPage[]
  trashCount: number
  currentPageId: string | null
  onAddBook: () => void
  onMoveBookToTrash: (bookId: string) => void
  onMovePageToTrash: (pageId: string) => void
  onRestoreBook: (bookId: string) => void
  onRestorePage: (pageId: string) => void
  onDeleteBookPermanently: (bookId: string) => void
  onDeletePagePermanently: (pageId: string) => void
  /** 清空回收站：把所有软删除的文库和文档一次抹掉 */
  onEmptyTrash: () => void
  onRenameBook: (bookId: string, name: string) => void
  onRenamePage: (pageId: string, title: string) => void
  onSelectPage: (page: LyricPage) => void
  onAddPage: (bookId: string) => void
  onExportBackup: () => void
  onRestoreBackup: (file: File) => void
  onReorderBooks: (orderedIds: string[]) => void
  onReorderPages: (entries: Array<{ id: string; bookId: string | null }>) => void
  /** 导入一个文件；能接受哪些格式由导入层决定，界面不必知道 */
  onImportFile: (file: File) => void
  readerSettings: ReaderSettings
  onReaderSettingsChange: (s: ReaderSettings) => void
  /** 侧栏此刻是不是被呼出着（仅手机尺寸有意义；宽屏一直挂着，恒为 false） */
  panelOpen?: boolean
  className?: string
  /** 有多宽（像素）。宽屏可拖着改，不给就是 250 —— 见 App.tsx 那根拖杆 */
  width?: number
}

type Editing = { type: 'book'; id: string } | { type: 'page'; id: string } | null
type MenuKind = { type: 'book'; id: string } | { type: 'page'; id: string } | null
type ItemKind = { type: 'book'; id: string } | { type: 'page'; id: string; bookId: string | null }

const COLLAPSED_KEY = 'lyric-vocab-collapsed-books'
const SIDEBAR_HEADER_HEIGHT = 160

const restrictToSidebarArea: Modifier = ({ transform, draggingNodeRect }) => {
  if (!draggingNodeRect) return transform
  // 限制拖拽元素的顶部不超过侧边栏头部（模式切换区域）
  const minY = SIDEBAR_HEADER_HEIGHT - draggingNodeRect.top
  return {
    ...transform,
    y: Math.max(transform.y, minY)
  }
}

interface SortableRowProps {
  id: string
  data: ItemKind
  children: (handleProps: { listeners: any; attributes: any; isDragging: boolean }) => React.ReactNode
  disabled?: boolean
}

function SortableRow({ id, data, children, disabled }: SortableRowProps) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({
    id,
    data,
    disabled
  })

  const style: React.CSSProperties = {
    transform: CSS.Transform.toString(transform),
    transition,
    zIndex: isDragging ? 999 : undefined,
    opacity: isDragging ? 0.2 : 1
  }

  return (
    <div ref={setNodeRef} style={style}>
      {children({ listeners, attributes, isDragging })}
    </div>
  )
}

function LeftSidebarInner({
  mode,
  onModeChange,
  reviewTarget,
  onReviewTargetChange,
  books,
  pages,
  deletedBooks,
  deletedPages,
  trashCount,
  currentPageId,
  onAddBook,
  onMoveBookToTrash,
  onMovePageToTrash,
  onRestoreBook,
  onRestorePage,
  onDeleteBookPermanently,
  onDeletePagePermanently,
  onEmptyTrash,
  onRenameBook,
  onRenamePage,
  onSelectPage,
  onAddPage,
  onExportBackup,
  onRestoreBackup,
  onReorderBooks,
  onReorderPages,
  onImportFile,
  readerSettings,
  onReaderSettingsChange,
  panelOpen = false,
  className = '',
  width
}: LeftSidebarProps) {
  const [pageLayout, setPageLayout] = useState<LyricPage[]>(pages)
  /**
   * 文库顺序的本地副本。
   * 和 pageLayout 同理：拖拽过程中先在本地重排，松手时列表已经在新位置上，
   * 掉落动画才不会先飞回原处、等数据绕一圈回来再跳过去。
   */
  const [bookLayout, setBookLayout] = useState<LyricBook[]>(books)
  const [editing, setEditing] = useState<Editing>(null)
  const [editValue, setEditValue] = useState('')
  const [menuOpen, setMenuOpen] = useState<MenuKind>(null)
  const [recycleOpen, setRecycleOpen] = useState(false)
  /**
   * 彻底删除的二次确认。`all` 是清空整个回收站，没有 id。
   * 和单条删除共用一个弹窗 —— 问的是同一件事（不可恢复），
   * 只是措辞和范围不同。
   */
  const [confirmDelete, setConfirmDelete] = useState<
    { type: 'book' | 'page'; id: string } | { type: 'all' } | null
  >(null)
  const [collapsedBooks, setCollapsedBooks] = useState<Record<string, boolean>>({})
  // 安卓返回键：先关二次确认，再关回收站
  useBackHandler(!!confirmDelete, BackPriority.confirmDelete, () => setConfirmDelete(null))
  useBackHandler(recycleOpen, BackPriority.recycleBin, () => setRecycleOpen(false))

  const [organizeMode, setOrganizeMode] = useState(false)
  const [activeItem, setActiveItem] = useState<ItemKind | null>(null)
  const [dragOverBookId, setDragOverBookId] = useState<string | null>(null)
  const [settingsOpen, setSettingsOpen] = useState(false)
  const [libraryOpen, setLibraryOpen] = useState(false)
  const preEditOpenFoldersRef = useRef<string[] | null>(null)
  const inputRef = useRef<HTMLInputElement>(null)
  const txtFileInputRef = useRef<HTMLInputElement>(null)

  // 全局点击：当菜单打开时，点击任意「非菜单 / 非触发按钮」区域都会关闭菜单
  useEffect(() => {
    const handleGlobalClick = (event: MouseEvent) => {
      if (!menuOpen) return
      const target = event.target as HTMLElement | null
      if (!target) return

      // 点击在菜单弹层内部：不关闭，由菜单自身逻辑处理
      if (target.closest('[data-menu-popup]')) return
      // 点击在触发按钮（更多）上：交给按钮自己的逻辑处理
      if (target.closest('[data-menu-trigger]')) return

      setMenuOpen(null)
    }

    window.addEventListener('click', handleGlobalClick)
    return () => {
      window.removeEventListener('click', handleGlobalClick)
    }
  }, [menuOpen])

  useEffect(() => {
    // 外部数据变更时，同步更新本地布局（例如加载/恢复备份）
    setBookLayout(books)
  }, [books])

  useEffect(() => {
    // 外部数据变更时，同步更新本地布局（例如加载/恢复备份）
    setPageLayout(pages)
  }, [pages])

  const sensors = useSensors(
    // PointerSensor 作为主传感器：激活阈值很小，安全性来自“必须点中手柄”这一事实
    useSensor(PointerSensor, {
      activationConstraint: {
        distance: 5
      }
    })
  )

  /**
   * 退出整理模式：把进入前展开着的文库恢复回去。
   *
   * 拆成单独一个函数，是因为退出有两条路 —— 手动点「整理」，
   * 以及侧栏被收起时自动退出。两条路必须做同样的善后。
   */
  const exitOrganizeMode = useCallback(() => {
    if (preEditOpenFoldersRef.current) {
      const openSet = new Set(preEditOpenFoldersRef.current)
      const restored: Record<string, boolean> = {}
      for (const b of books) {
        restored[b.id] = !openSet.has(b.id)
      }
      setCollapsedBooks(restored)
      try {
        localStorage.setItem(COLLAPSED_KEY, JSON.stringify(restored))
      } catch {}
    }
    preEditOpenFoldersRef.current = null
    setOrganizeMode(false)
  }, [books])

  const toggleOrganizeMode = useCallback(() => {
    // 整理模式下不显示「更多」按钮，菜单开着时切进来会连带消失，
    // 状态留着没意义，顺手清掉
    setMenuOpen(null)

    if (!organizeMode) {
      // 进入整理模式：记录当前展开的文库，并折叠全部
      const openIds = books.filter((b) => !collapsedBooks[b.id]).map((b) => b.id)
      preEditOpenFoldersRef.current = openIds

      const allCollapsed: Record<string, boolean> = {}
      for (const b of books) {
        allCollapsed[b.id] = true
      }
      setCollapsedBooks(allCollapsed)
      try {
        localStorage.setItem(COLLAPSED_KEY, JSON.stringify(allCollapsed))
      } catch {}
      setOrganizeMode(true)
    } else {
      exitOrganizeMode()
    }
  }, [books, collapsedBooks, organizeMode, exitOrganizeMode])

  /**
   * 侧栏被收起时自动退出整理模式。
   *
   * 只认「开着 -> 关上」这个变化，不是「当前没开着就退出」——
   * 宽屏上左侧栏一直挂着、panelOpen 恒为 false，后者会让整理模式刚点开就被关掉。
   */
  const panelWasOpenRef = useRef(panelOpen)
  useEffect(() => {
    const wasOpen = panelWasOpenRef.current
    panelWasOpenRef.current = panelOpen
    if (wasOpen && !panelOpen && organizeMode) exitOrganizeMode()
  }, [panelOpen, organizeMode, exitOrganizeMode])

  useEffect(() => {
    if (editing && inputRef.current) {
      inputRef.current.focus()
      inputRef.current.select()
    }
  }, [editing])

  const startEditBook = useCallback((book: LyricBook) => {
    setMenuOpen(null)
    setEditing({ type: 'book', id: book.id })
    setEditValue(book.name)
  }, [])

  const startEditPage = useCallback((page: LyricPage) => {
    setMenuOpen(null)
    setEditing({ type: 'page', id: page.id })
    setEditValue(page.title || '未命名')
  }, [])

  const commitEdit = useCallback(() => {
    if (!editing) return
    const value = editValue.trim()
    if (editing.type === 'book') {
      if (value) onRenameBook(editing.id, value)
    } else {
      onRenamePage(editing.id, value || '未命名')
    }
    setEditing(null)
  }, [editing, editValue, onRenameBook, onRenamePage])

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      if (e.key === 'Enter') {
        e.preventDefault()
        commitEdit()
      }
      if (e.key === 'Escape') {
        setEditing(null)
      }
    },
    [commitEdit]
  )

  const isBookSelected = (bookId: string) =>
    mode === 'review' && reviewTarget?.type === 'book' && reviewTarget.id === bookId
  const isPageSelected = (pageId: string) =>
    mode === 'read'
      ? currentPageId === pageId
      : mode === 'review' && reviewTarget?.type === 'page' && reviewTarget.id === pageId

  const handleBookClick = useCallback(
    (book: LyricBook) => {
      if (mode === 'review') onReviewTargetChange({ type: 'book', id: book.id })
    },
    [mode, onReviewTargetChange]
  )

  const handlePageClick = useCallback(
    (page: LyricPage) => {
      if (mode === 'read') onSelectPage(page)
      else onReviewTargetChange({ type: 'page', id: page.id })
    },
    [mode, onSelectPage, onReviewTargetChange]
  )

  const handleTxtFileChange = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      const file = e.target.files?.[0]
      if (file) onImportFile(file)
      e.target.value = ''
    },
    [onImportFile]
  )

  // 根级文档：bookId 为 null，且未被软删除
  const rootPages = pageLayout.filter((p) => !p.bookId && !p.deletedAt)

  const toggleBookCollapsed = useCallback((bookId: string) => {
    setCollapsedBooks((prev) => {
      const next = { ...prev, [bookId]: !prev[bookId] }
      try {
        localStorage.setItem(COLLAPSED_KEY, JSON.stringify(next))
      } catch {
        // 忽略本地存储错误，避免影响交互
      }
      return next
    })
  }, [])

  // 初始化折叠状态：从本地存储恢复用户上次的设置
  useEffect(() => {
    try {
      const raw = localStorage.getItem(COLLAPSED_KEY)
      if (!raw) return
      const parsed = JSON.parse(raw) as Record<string, boolean>
      if (parsed && typeof parsed === 'object') {
        setCollapsedBooks(parsed)
      }
    } catch {
      // 忽略解析错误，使用默认展开状态
    }
  }, [])

  const handleDragStart = useCallback(
    (event: DragStartEvent) => {
      if (!organizeMode) return
      const data = event.active.data.current as ItemKind | undefined
      if (!data) return

      setActiveItem(data)
    },
    [organizeMode]
  )

  const handleDragOver = useCallback(
    (event: DragOverEvent) => {
      const { active, over } = event
      if (!over) {
        setDragOverBookId(null)
        return
      }

      const activeData = active.data.current as ItemKind | undefined
      const overData = over.data.current as ItemKind | undefined
      if (!activeData || !overData) {
        setDragOverBookId(null)
        return
      }

      // 实时乐观更新：文库拖到另一个文库上时，立即调整 bookLayout
      if (activeData.type === 'book' && overData.type === 'book') {
        const activeBookId = activeData.id
        const overBookId = overData.id

        setBookLayout((current) => {
          const fromIndex = current.findIndex((b) => b.id === activeBookId)
          const toIndex = current.findIndex((b) => b.id === overBookId)
          if (fromIndex === -1 || toIndex === -1 || fromIndex === toIndex) return current

          const next = [...current]
          const [moved] = next.splice(fromIndex, 1)
          next.splice(toIndex, 0, moved)
          return next
        })
        setDragOverBookId(null)
        return
      }

       // 实时乐观更新：文档拖到其他文档或文库时，立即调整 pageLayout
       if (activeData.type === 'page' && overData.type === 'page') {
         const activePageId = activeData.id
         const overPageId = overData.id
         const overBookId = overData.bookId

         setPageLayout((current) => {
           const fromIndex = current.findIndex((p) => p.id === activePageId)
           const toIndex = current.findIndex((p) => p.id === overPageId)
           if (fromIndex === -1 || toIndex === -1 || fromIndex === toIndex) return current

           const next = [...current]
           const [moved] = next.splice(fromIndex, 1)
           const updatedMoved: LyricPage =
             moved.bookId === overBookId ? moved : { ...moved, bookId: overBookId }
           next.splice(toIndex, 0, updatedMoved)
           return next
         })
       }

       if (activeData.type === 'page' && overData.type === 'book') {
         const activePageId = activeData.id
         const targetBookId = overData.id

         setPageLayout((current) => {
           const fromIndex = current.findIndex((p) => p.id === activePageId)
           if (fromIndex === -1) return current

           const next = [...current]
           const [moved] = next.splice(fromIndex, 1)
           const updatedMoved: LyricPage = { ...moved, bookId: targetBookId }

           // 插入到目标文库现有文档的末尾（如果没有文档则插到末尾）
           let insertIndex = next.length
           for (let i = next.length - 1; i >= 0; i -= 1) {
             if (next[i].bookId === targetBookId) {
               insertIndex = i + 1
               break
             }
           }
           next.splice(insertIndex, 0, updatedMoved)
           return next
         })
       }

      // 文档悬停在文库标题行上时，高亮该文库并自动展开
      if (activeData.type === 'page' && overData.type === 'book') {
        setDragOverBookId(overData.id)
        setCollapsedBooks((prev) =>
          prev[overData.id] ? { ...prev, [overData.id]: false } : prev
        )
      } else {
        setDragOverBookId(null)
      }
    },
    []
  )

  const handleDragEnd = useCallback(
    (event: DragEndEvent) => {
      const { active } = event

      const activeData = active.data.current as ItemKind | undefined
      if (!activeData) return

      // 文库排序：拖拽过程中已通过 handleDragOver 实时更新 bookLayout，
      // 这里直接按最终的 bookLayout 持久化（与文档的处理保持一致）
      if (activeData.type === 'book') {
        onReorderBooks(bookLayout.map((b) => b.id))
      }

      // 文档拖拽：
      // - 在拖拽过程中已通过 handleDragOver 实时更新 pageLayout
      // - 这里无论最终落点是文档还是文库标题行，统一根据「最终的 pageLayout」持久化顺序
      if (activeData.type === 'page') {
        const entries: Array<{ id: string; bookId: string | null }> = pageLayout
          .filter((p) => !p.deletedAt)
          .map((p) => ({ id: p.id, bookId: p.bookId }))
        onReorderPages(entries)
      }

      setActiveItem(null)
      setDragOverBookId(null)
    },
    [bookLayout, pageLayout, onReorderBooks, onReorderPages]
  )

  const renderActiveOverlay = () => {
    if (!activeItem) return null
    if (activeItem.type === 'book') {
      const book = bookLayout.find((b) => b.id === activeItem.id)
      if (!book) return null
      return (
        <div className="mb-4">
          <div className="flex items-center gap-1 px-3 py-2.5 rounded-xl bg-white shadow-lg border border-accent-300">
            <ChevronRight className="w-3 h-3 opacity-50" />
            <Book className="w-4 h-4 text-accent-700/80 shrink-0 mt-0.5" />
            <span className="text-sm text-ink font-medium flex-1 min-w-0 truncate leading-snug">
              {book.name}
            </span>
          </div>
        </div>
      )
    }
    const page = pages.find((p) => p.id === activeItem.id)
    if (!page) return null
    const isSelected = page.id === currentPageId
    return (
      <div className="px-3 py-2 rounded-lg bg-white shadow-lg border border-accent-300 flex items-center gap-2">
        <FileText
          className={`w-3.5 h-3.5 shrink-0 mt-0.5 ${
            isSelected ? 'text-accent-700' : 'text-ink-muted'
          }`}
        />
        <span
          className={`flex-1 min-w-0 text-sm truncate leading-relaxed ${
            isSelected ? 'text-accent-800 font-medium' : 'text-ink-muted'
          }`}
        >
          {page.title || '未命名'}
        </span>
      </div>
    )
  }

  return (
    <aside
      className={`h-full shrink-0 border-r border-paper-border bg-white/80 flex flex-col overflow-hidden safe-area-padding ${className}`}
      /* 宽度由上面给：宽屏可以拖着改（见 App.tsx 那根拖杆），窄屏一律 250 */
      style={{ width: width ?? 250 }}
    >
      <div className={BAND_TOP}>
        <span className="text-sm font-medium text-ink-muted tracking-wide">我的文库</span>
        <div className="flex items-center gap-1">
          {/*
            照右侧栏那颗「AI 划词」的样子做：图标 + 文字、不描边、hover 才出底色、
            text-sm。从前是个 42×26 描边的小文字按钮，和旁边那枚纯图标按钮凑不成一对
            （见 后续规划.md 第三十五节）。现在全 App 的次级操作是同一套长相。

            图标用 GripVertical —— 就是点开之后每一行右边冒出来的那个拖拽手柄，
            按钮和它要你干的事用同一个图案。

            但它和「AI 划词」有一处必须不同：整理是**模式开关**，会一直亮着，
            所以留着填色的选中态；AI 划词是一次性动作，没有「开着」这回事。
          */}
          <button
            type="button"
            onClick={toggleOrganizeMode}
            className={`flex items-center gap-1 px-2 py-[5px] rounded-lg text-sm font-medium transition-colors ${
              organizeMode
                ? 'bg-accent-600 text-white'
                : 'text-ink-muted hover:bg-stone-100 hover:text-accent-700'
            }`}
            title="整理文库与文档顺序"
          >
            <GripVertical className="w-3.5 h-3.5 shrink-0" />
            整理
          </button>
        </div>
      </div>

      {/*
        双模式切换：三列共用的第二带。
        从前是个带底色的药丸（盒中盒），在 40px 的带里只剩 4px 空气，用户说挤。
        拆掉外框和底色改成纯文字标签之后，两颗按钮直接把整条带撑满 ——
        不加高、正文一点不少，点得着的高度反而从 28px 变成整条 40px。
      */}
      <div className={BAND_SUB}>
        <div className="flex w-full self-stretch">
          <button
            type="button"
            onClick={() => onModeChange('read')}
            className={`flex flex-1 items-center justify-center gap-1.5 border-b-2 text-sm font-medium transition-colors ${
              mode === 'read'
                ? 'border-accent-700 text-accent-800'
                : 'border-transparent text-ink-muted hover:text-ink'
            }`}
          >
            <BookOpen className="w-4 h-4" />
            阅读
          </button>
          <button
            type="button"
            onClick={() => onModeChange('review')}
            className={`flex flex-1 items-center justify-center gap-1.5 border-b-2 text-sm font-medium transition-colors ${
              mode === 'review'
                ? 'border-accent-700 text-accent-800'
                : 'border-transparent text-ink-muted hover:text-ink'
            }`}
          >
            <Brain className="w-4 h-4" />
            复习
          </button>
        </div>
      </div>

      <DndContext
        sensors={sensors}
        collisionDetection={closestCorners}
        modifiers={[restrictToVerticalAxis, restrictToWindowEdges, restrictToSidebarArea]}
        onDragStart={organizeMode ? handleDragStart : undefined}
        onDragOver={organizeMode ? handleDragOver : undefined}
        onDragEnd={organizeMode ? handleDragEnd : undefined}
      >
        <div
          className="flex-1 min-h-0 overflow-y-auto scroll-area py-3 px-2"
          onClick={(e) => {
            if (menuOpen && !(e.target as HTMLElement).closest('[data-menu-popup]')) {
              setMenuOpen(null)
            }
          }}
        >
          <div className="min-h-full flex flex-col">
            <div className="flex-1 min-h-0">
              {/* 根级未分组文档 */}
              {rootPages.length > 0 && (
            <div className="mb-4">
              <div className="px-3 pb-1 text-xs font-medium text-ink-muted">
                未分组文档
              </div>
              <SortableContext items={rootPages.map((p) => p.id)} strategy={verticalListSortingStrategy}>
                <div className="space-y-1">
                  {rootPages.map((page) => {
                    const isSelected = isPageSelected(page.id)
                    const isEditingPage = editing?.type === 'page' && editing.id === page.id
                    const isMenuPage = menuOpen?.type === 'page' && menuOpen.id === page.id
                    return (
                      <SortableRow
                        key={page.id}
                        id={page.id}
                        data={{ type: 'page', id: page.id, bookId: null }}
                        disabled={!organizeMode}
                      >
                        {({ listeners: pageListeners }) => (
                          <div
                            className={`flex items-center gap-1 px-3 py-2 rounded-lg transition-colors ${
                              isSelected && !isEditingPage
                                ? 'bg-accent-50/90 border border-accent-200/60'
                                : 'hover:bg-stone-100 border border-transparent'
                            }`}
                          >
                            <button
                              type="button"
                              onClick={() => !isEditingPage && handlePageClick(page)}
                              className="flex-1 min-w-0 flex items-center gap-2 text-left"
                            >
                              <FileText
                                className={`w-3.5 h-3.5 shrink-0 mt-0.5 ${
                                  isSelected ? 'text-accent-700' : 'text-ink-muted'
                                }`}
                              />
                              {isEditingPage ? (
                                <input
                                  ref={isEditingPage ? inputRef : undefined}
                                  type="text"
                                  value={editValue}
                                  onChange={(e) => setEditValue(e.target.value)}
                                  onBlur={commitEdit}
                                  onKeyDown={handleKeyDown}
                                  className="flex-1 min-w-0 px-2 py-1 text-sm rounded-md border border-paper-border bg-paper focus:outline-none focus:ring-2 focus:ring-accent-500/30 focus:border-accent-500 text-ink"
                                  onClick={(e) => e.stopPropagation()}
                                />
                              ) : (
                                <span
                                  className={`flex-1 min-w-0 text-sm truncate leading-relaxed ${
                                    isSelected ? 'text-accent-800 font-medium' : 'text-ink-muted hover:text-ink'
                                  }`}
                                >
                                  {page.title || '未命名'}
                                </span>
                              )}
                            </button>
                            {!isEditingPage && !organizeMode && (
                              <div className="relative shrink-0">
                                <button
                                  type="button"
                                  onClick={(e) => {
                                    e.stopPropagation()
                                    setMenuOpen(isMenuPage ? null : { type: 'page', id: page.id })
                                  }}
                                  className="p-1.5 rounded-lg hover:bg-stone-200 text-ink-muted hover:text-ink"
                                  title="更多"
                                  aria-haspopup="true"
                                  aria-expanded={isMenuPage}
                                  data-menu-trigger
                                >
                                  <MoreHorizontal className="w-4 h-4" />
                                </button>
                                {isMenuPage && (
                                  <>
                                    <div
                                      className="fixed inset-0 z-40 pointer-events-none"
                                      aria-hidden
                                    />
                                    {/*
                                      「更多」菜单。同一串类名在这个文件里有三处
                                      （文档、文库、回收站里的条目），改一处记得三处都改。

                                      `whitespace-nowrap` 是必需的：140px 只是**下限**，
                                      菜单本该按里面最长那条撑开。少了它，绝对定位的盒子
                                      会照可用宽度去挤，「移至回收站」在平板上折成两行 ——
                                      用户报的。根子不是这个数不够大，是**系统把字放大了**
                                      （WebView 的 textZoom），写死多宽都只是把门槛往后挪。
                                      量过：根字号 16→22 时，那一项从 50px 高变成 77px。
                                    */}
                                    <div
                                      className="absolute right-0 top-full mt-1 z-50 min-w-[140px] whitespace-nowrap py-1 rounded-lg border border-paper-border bg-white shadow-lg pointer-events-auto"
                                      data-menu-popup
                                    >
                                      <button
                                        type="button"
                                        className="w-full flex items-center gap-2 px-3 py-2 text-left text-sm text-ink hover:bg-stone-100"
                                        onClick={() => startEditPage(page)}
                                      >
                                        <Pencil className="w-3.5 h-3.5" />
                                        重命名
                                      </button>
                                      <button
                                        type="button"
                                        className="w-full flex items-center gap-2 px-3 py-2 text-left text-sm text-red-600 hover:bg-red-50"
                                        onClick={() => {
                                          onMovePageToTrash(page.id)
                                          setMenuOpen(null)
                                        }}
                                      >
                                        <Trash2 className="w-3.5 h-3.5" />
                                        移至回收站
                                      </button>
                                    </div>
                                  </>
                                )}
                              </div>
                            )}
                            {organizeMode && (
                              <button
                                type="button"
                                className="p-1 rounded text-ink-muted hover:text-ink cursor-grab active:cursor-grabbing"
                                style={{ touchAction: 'none' }}
                                aria-label="拖动排序文档"
                                {...pageListeners}
                              >
                                <GripVertical className="w-3.5 h-3.5" />
                              </button>
                            )}
                          </div>
                        )}
                      </SortableRow>
                    )
                  })}
                </div>
              </SortableContext>
            </div>
          )}
          {books.length === 0 && (
            <p className="px-3 py-4 text-sm text-ink-muted leading-relaxed">暂无文库，点击上方 + 新建</p>
          )}
          <SortableContext
            items={bookLayout.map((b) => b.id)}
            strategy={verticalListSortingStrategy}
          >
            {bookLayout.map((book) => {
              const bookPages = pageLayout.filter((p) => p.bookId === book.id && !p.deletedAt)
              const isEditingBook = editing?.type === 'book' && editing.id === book.id
              const bookSelected = isBookSelected(book.id)
              const isMenuBook = menuOpen?.type === 'book' && menuOpen.id === book.id
              const collapsed = !!collapsedBooks[book.id]
              const isDragOver = dragOverBookId === book.id

              return (
                <SortableRow
                  key={book.id}
                  id={book.id}
                  data={{ type: 'book', id: book.id }}
                  disabled={!organizeMode}
                >
                  {({ listeners }) => (
                    <div className="mb-4">
                      <div
                        className={`flex items-center gap-1 px-3 py-2.5 rounded-xl transition-colors ${
                          !isEditingBook ? 'hover:bg-stone-100' : ''
                        } ${bookSelected ? 'bg-accent-50/90 border border-accent-200/60' : ''} ${
                          isDragOver ? 'ring-2 ring-accent-400' : ''
                        }`}
                      >
                        {/* 折叠小三角，仅控制展开/折叠，不触发进入文库 */}
                        <button
                          type="button"
                          onClick={() => toggleBookCollapsed(book.id)}
                          className="p-1 rounded hover:bg-stone-100 text-ink-muted"
                          aria-label={collapsed ? '展开文库' : '折叠文库'}
                        >
                          <ChevronRight
                            className={`w-3 h-3 transition-transform ${collapsed ? '' : 'rotate-90'}`}
                          />
                        </button>
                        {/* 文库文字区域：保持原有点击逻辑 */}
                        <button
                          type="button"
                          onClick={() => !isEditingBook && handleBookClick(book)}
                          className="flex-1 min-w-0 flex items-center gap-2 text-left shrink-0"
                        >
                          {collapsed ? (
                            <Book className="w-4 h-4 text-accent-700/80 shrink-0 mt-0.5" />
                          ) : (
                            <BookOpen className="w-4 h-4 text-accent-700/80 shrink-0 mt-0.5" />
                          )}
                          {isEditingBook ? (
                            <input
                              ref={editing?.type === 'book' ? inputRef : undefined}
                              type="text"
                              value={editValue}
                              onChange={(e) => setEditValue(e.target.value)}
                              onBlur={commitEdit}
                              onKeyDown={handleKeyDown}
                              className="flex-1 min-w-0 px-2 py-1 text-sm rounded-lg border border-paper-border bg-paper focus:outline-none focus:ring-2 focus:ring-accent-500/30 focus:border-accent-500 text-ink"
                              onClick={(e) => e.stopPropagation()}
                            />
                          ) : (
                            <span className="text-sm text-ink font-medium flex-1 min-w-0 truncate leading-snug">
                              {book.name}
                            </span>
                          )}
                        </button>
                        {/* 右侧更多菜单 */}
                        {!isEditingBook && !organizeMode && (
                          <div className="relative shrink-0">
                          <button
                              type="button"
                              onClick={(e) => {
                                e.stopPropagation()
                                setMenuOpen(isMenuBook ? null : { type: 'book', id: book.id })
                              }}
                              className="p-1.5 rounded-lg hover:bg-stone-200 text-ink-muted hover:text-ink"
                              title="更多"
                              aria-haspopup="true"
                              aria-expanded={isMenuBook}
                            data-menu-trigger
                            >
                              <MoreHorizontal className="w-4 h-4" />
                            </button>
                            {isMenuBook && (
                              <>
                                <div
                                  className="fixed inset-0 z-40 pointer-events-none"
                                  aria-hidden
                                />
                                <div
                                  className="absolute right-0 top-full mt-1 z-50 min-w-[140px] whitespace-nowrap py-1 rounded-lg border border-paper-border bg-white shadow-lg pointer-events-auto"
                                  data-menu-popup
                                >
                                  <button
                                    type="button"
                                    className="w-full flex items-center gap-2 px-3 py-2 text-left text-sm text-ink hover:bg-stone-100"
                                    onClick={() => { startEditBook(book) }}
                                  >
                                    <Pencil className="w-3.5 h-3.5" />
                                    重命名
                                  </button>
                                  <button
                                    type="button"
                                    className="w-full flex items-center gap-2 px-3 py-2 text-left text-sm text-ink hover:bg-stone-100"
                                    onClick={() => { onAddPage(book.id); setMenuOpen(null) }}
                                  >
                                    <FileText className="w-3.5 h-3.5" />
                                    新建文档
                                  </button>
                                  <button
                                    type="button"
                                    className="w-full flex items-center gap-2 px-3 py-2 text-left text-sm text-red-600 hover:bg-red-50"
                                    onClick={() => { onMoveBookToTrash(book.id); setMenuOpen(null) }}
                                  >
                                    <Trash2 className="w-3.5 h-3.5" />
                                    移至回收站
                                  </button>
                                </div>
                              </>
                            )}
                          </div>
                        )}
                        {/* 拖拽手柄：仅在整理模式中显示，且只有按住它才能拖动 */}
                        {organizeMode && (
                          <button
                            type="button"
                            className="p-1 rounded text-ink-muted hover:text-ink cursor-grab active:cursor-grabbing"
                            style={{ touchAction: 'none' }}
                            aria-label="拖动排序文库"
                            {...listeners}
                          >
                            <GripVertical className="w-3.5 h-3.5" />
                          </button>
                        )}
                      </div>
                      {/* 文档列表：可折叠 */}
                      {!collapsed && (
                        <SortableContext
                          items={bookPages.map((p) => p.id)}
                          strategy={verticalListSortingStrategy}
                        >
                          <div className="pl-7 pr-1 mt-1 space-y-1">
                            {bookPages.map((page) => {
                              const isSelected = isPageSelected(page.id)
                              const isEditingPage = editing?.type === 'page' && editing.id === page.id
                              const isMenuPage = menuOpen?.type === 'page' && menuOpen.id === page.id
                              return (
                                <SortableRow
                                  key={page.id}
                                  id={page.id}
                                  data={{ type: 'page', id: page.id, bookId: book.id }}
                                  disabled={!organizeMode}
                                >
                                  {({ listeners: pageListeners }) => (
                                    <div
                                      className={`flex items-center gap-1 px-3 py-2 rounded-lg transition-colors ${
                                        isSelected && !isEditingPage
                                          ? 'bg-accent-50/90 border border-accent-200/60'
                                          : 'hover:bg-stone-100 border border-transparent'
                                      }`}
                                    >
                                      <button
                                        type="button"
                                        onClick={() => !isEditingPage && handlePageClick(page)}
                                        className="flex-1 min-w-0 flex items-center gap-2 text-left"
                                      >
                                        <FileText
                                          className={`w-3.5 h-3.5 shrink-0 mt-0.5 ${
                                            isSelected ? 'text-accent-700' : 'text-ink-muted'
                                          }`}
                                        />
                                        {isEditingPage ? (
                                          <input
                                            ref={isEditingPage ? inputRef : undefined}
                                            type="text"
                                            value={editValue}
                                            onChange={(e) => setEditValue(e.target.value)}
                                            onBlur={commitEdit}
                                            onKeyDown={handleKeyDown}
                                            className="flex-1 min-w-0 px-2 py-1 text-sm rounded-md border border-paper-border bg-paper focus:outline-none focus:ring-2 focus:ring-accent-500/30 focus:border-accent-500 text-ink"
                                            onClick={(e) => e.stopPropagation()}
                                          />
                                        ) : (
                                          <span
                                            className={`flex-1 min-w-0 text-sm truncate leading-relaxed ${
                                              isSelected ? 'text-accent-800 font-medium' : 'text-ink-muted hover:text-ink'
                                            }`}
                                          >
                                            {page.title || '未命名'}
                                          </span>
                                        )}
                                      </button>
                                      {!isEditingPage && !organizeMode && (
                                        <div className="relative shrink-0">
                                          <button
                                            type="button"
                                            onClick={(e) => {
                                              e.stopPropagation()
                                              setMenuOpen(isMenuPage ? null : { type: 'page', id: page.id })
                                            }}
                                            className="p-1.5 rounded-lg hover:bg-stone-200 text-ink-muted hover:text-ink"
                                            title="更多"
                                            aria-haspopup="true"
                                            aria-expanded={isMenuPage}
                                            data-menu-trigger
                                          >
                                            <MoreHorizontal className="w-4 h-4" />
                                          </button>
                                          {isMenuPage && (
                                            <>
                                              <div
                                                className="fixed inset-0 z-40 pointer-events-none"
                                                aria-hidden
                                              />
                                              <div
                                                className="absolute right-0 top-full mt-1 z-50 min-w-[140px] whitespace-nowrap py-1 rounded-lg border border-paper-border bg-white shadow-lg pointer-events-auto"
                                                data-menu-popup
                                              >
                                                <button
                                                  type="button"
                                                  className="w-full flex items-center gap-2 px-3 py-2 text-left text-sm text-ink hover:bg-stone-100"
                                                  onClick={() => startEditPage(page)}
                                                >
                                                  <Pencil className="w-3.5 h-3.5" />
                                                  重命名
                                                </button>
                                                <button
                                                  type="button"
                                                  className="w-full flex items-center gap-2 px-3 py-2 text-left text-sm text-red-600 hover:bg-red-50"
                                                  onClick={() => { onMovePageToTrash(page.id); setMenuOpen(null) }}
                                                >
                                                  <Trash2 className="w-3.5 h-3.5" />
                                                  移至回收站
                                                </button>
                                              </div>
                                            </>
                                          )}
                                        </div>
                                      )}
                                      {organizeMode && (
                                        <button
                                          type="button"
                                          className="p-1 rounded text-ink-muted hover:text-ink cursor-grab active:cursor-grabbing"
                                          style={{ touchAction: 'none' }}
                                          aria-label="拖动排序文档"
                                          {...pageListeners}
                                        >
                                          <GripVertical className="w-3.5 h-3.5" />
                                        </button>
                                      )}
                                    </div>
                                  )}
                                </SortableRow>
                              )
                            })}
                          </div>
                        </SortableContext>
                      )}
                    </div>
                  )}
                </SortableRow>
              )
            })}
          </SortableContext>

          {/*
           * 「新建文库」放在文库列表的末尾，而不是顶栏。
           *
           * 从前它在顶栏，是个**纯图标**按钮，挨着「整理」那个有框有字的按钮 ——
           * 两个不是一类的东西并排：一个 42×26 有边框有文字，一个 32×32 无边框
           * 只有图标；语义也不是一类（整理是模式开关，新建是一次性动作）。
           * 而且它的说明全写在 title 里，**手机上没有 hover，title 根本不存在**，
           * 等于一个哑谜 —— 这个坑第十九节（底部五个图标）和第二十二节（魔杖）
           * 已经各踩过一次，这是漏网的第三个。
           *
           * 挪到列表末尾：创建的入口贴着被创建的东西，是最好猜的位置；
           * 顺带有了文字，也有了够手指点的高度（量出来 48px，正好是安卓的最小推荐值；
           * 顶栏那个只有 32px）。
           *
           * 整理模式下不显示 —— 那会儿在拖拽排序，新建是另一码事。
           */}
          {!organizeMode && (
            <button
              type="button"
              onClick={onAddBook}
              // py-3.5 而不是照抄文库行的 py-2.5：文库行里还挂着一个 p-1.5 的「更多」按钮
              // 把行撑到 49px，这一行没有，照抄只有 40px、看着矮一截。
              // 14px 上下留白凑出 48px，和文库行差 1px，顺带够到安卓的最小触摸目标
              className="flex w-full items-center gap-1 rounded-xl px-3 py-3.5 text-left text-ink-muted transition-colors hover:bg-stone-100 hover:text-ink"
            >
              {/*
                左边这个加号占的是文库行「折叠三角」那一格。
                原来这行只有图标加文字、左边空着一格，看着**飘**（用户的原话）——
                列表里每一行都是「三段」，只有它是两段，那一竖列就断了。
                填上之后三条竖线全对齐：加号 x=20、文件夹 x=44、文字 x=68。
              */}
              <span className="p-1 shrink-0" aria-hidden>
                <Plus className="w-3 h-3" />
              </span>
              <span className="flex-1 min-w-0 flex items-center gap-2">
                <FolderPlus className="w-4 h-4 shrink-0" aria-hidden />
                <span className="text-sm leading-snug">新建文库</span>
              </span>
            </button>
          )}
            </div>

            {/* 底部版权信息：始终贴住目录滚动区域底部 */}
            <div className="shrink-0 mt-6 mb-2 px-2 text-center text-[11px] text-ink-muted/60 select-none">
              © 2026 荧惑纪 . All Rights Reserved.
            </div>
          </div>
        </div>
        {createPortal(
          <DragOverlay>
            {renderActiveOverlay()}
          </DragOverlay>,
          document.body
        )}
      </DndContext>

      {/*
       * 底部三格：导入 / 回收站 / 设置。
       *
       * 从前是五个光秃秃的图标（导入、外观、导出备份、恢复备份、回收站），
       * 只有 title 提示 —— 那是鼠标悬停才冒出来的东西，手机上根本不存在，
       * 五个格子等于五个哑谜。而且三类性质不同的东西排成一样宽的五格：
       * 导入是天天用的动作、回收站是东西的去处、另外三个是低频设置。
       * 现在设置类的全收进设置页，剩下三格，每格 83px，放得下图标加文字。
       *
       * 2026-09-02 加了「书库」变成四格，每格 62px。**这个位置是临时的** ——
       * 书库和导入是同一类事（都是往里放内容），挤在这排四个平权的格子里
       * 未必是最终形态，等用户在手机上看过再定。
       */}
      <div className="shrink-0 border-t border-paper-border bg-gray-50">
        <div className="grid grid-cols-4 gap-px">
          <input
            ref={txtFileInputRef}
            type="file"
            accept={IMPORT_ACCEPT}
            className="hidden"
            onChange={handleTxtFileChange}
          />
          <button
            type="button"
            onClick={() => txtFileInputRef.current?.click()}
            className="flex h-14 w-full min-w-0 flex-col items-center justify-center gap-0.5 text-gray-600 transition-colors hover:bg-gray-100"
          >
            <FileText className="h-5 w-5 shrink-0" aria-hidden />
            <span className="text-[11px] leading-none">导入</span>
          </button>
          <button
            type="button"
            onClick={() => setLibraryOpen(true)}
            className="flex h-14 w-full min-w-0 flex-col items-center justify-center gap-0.5 text-gray-600 transition-colors hover:bg-gray-100"
          >
            <Library className="h-5 w-5 shrink-0" aria-hidden />
            <span className="text-[11px] leading-none">书库</span>
          </button>
          <button
            type="button"
            onClick={() => setRecycleOpen(true)}
            className="relative flex h-14 w-full min-w-0 flex-col items-center justify-center gap-0.5 text-gray-600 transition-colors hover:bg-gray-100"
          >
            <Trash2 className="h-5 w-5 shrink-0" aria-hidden />
            <span className="text-[11px] leading-none">回收站</span>
            {trashCount > 0 && (
              <span className="absolute right-2 top-1.5 flex h-3.5 min-w-[14px] items-center justify-center rounded-full bg-accent-500 px-1 text-[10px] font-medium text-white">
                {trashCount > 99 ? '99+' : trashCount}
              </span>
            )}
          </button>
          <button
            type="button"
            onClick={() => setSettingsOpen(true)}
            className="flex h-14 w-full min-w-0 flex-col items-center justify-center gap-0.5 text-gray-600 transition-colors hover:bg-gray-100"
          >
            <Settings className="h-5 w-5 shrink-0" aria-hidden />
            <span className="text-[11px] leading-none">设置</span>
          </button>
        </div>
      </div>

      {/*
       * 设置页。和下面的回收站一样用传送门挂到 body 上 ——
       * 侧栏外层带 transform，留在 aside 里的话遮罩只盖得住 250px 宽的侧栏。
       */}
      {/* 书库。同样走传送门，理由和设置页一样（侧栏带 transform，遮罩会被压在里面）*/}
      {libraryOpen &&
        createPortal(
          <LibraryDialog
            open={libraryOpen}
            onClose={() => setLibraryOpen(false)}
            onImport={onImportFile}
          />,
          document.body
        )}

      {settingsOpen &&
        createPortal(
          <SettingsDialog
            open={settingsOpen}
            onClose={() => setSettingsOpen(false)}
            readerSettings={readerSettings}
            onReaderSettingsChange={onReaderSettingsChange}
            onExportBackup={onExportBackup}
            onRestoreBackup={onRestoreBackup}
          />,
          document.body
        )}

      {/* 回收站弹窗 */}
      {/*
       * 用传送门挂到 body 上，而不是留在 aside 里面。
       * 侧栏外层带 transform，而 transform 会让内部 position:fixed 的定位基准
       * 从「整个屏幕」变成「侧栏本身」—— 遮罩因此只盖住 250px 宽的侧栏，
       * 点侧栏外面根本点不到它，弹窗还会跟着侧栏一起被收走。
       */}
      {recycleOpen && createPortal(
        <div
          className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/30 kb-safe"
          onClick={() => setRecycleOpen(false)}
        >
          <div
            className="bg-white rounded-xl shadow-xl border border-paper-border w-full max-w-md max-h-[80vh] flex flex-col"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="shrink-0 flex items-center justify-between p-3 border-b border-paper-border">
              <span className="text-sm font-medium text-ink">回收站</span>
              <button
                type="button"
                onClick={() => setRecycleOpen(false)}
                className="p-1.5 rounded-lg hover:bg-stone-100 text-ink-muted"
              >
                <X className="w-4 h-4" />
              </button>
            </div>
            <div className="flex-1 min-h-0 overflow-y-auto scroll-area p-3 space-y-2">
              {deletedBooks.length === 0 && deletedPages.length === 0 ? (
                <p className="text-sm text-ink-muted py-4 text-center">回收站为空</p>
              ) : (
                <>
                  {deletedBooks.map((b) => (
                    <div
                      key={b.id}
                      className="flex items-center justify-between gap-2 py-2 px-3 rounded-lg bg-stone-50 border border-stone-100"
                    >
                      <span className="text-sm text-ink truncate flex-1">{b.name}</span>
                      <span className="text-xs text-ink-muted shrink-0">文库</span>
                      <div className="flex items-center gap-1 shrink-0">
                        <button
                          type="button"
                          onClick={() => onRestoreBook(b.id)}
                          className="p-1.5 rounded hover:bg-stone-200 text-ink-muted hover:text-ink"
                          title="恢复"
                        >
                          <RotateCcw className="w-3.5 h-3.5" />
                        </button>
                        <button
                          type="button"
                          onClick={() => setConfirmDelete({ type: 'book', id: b.id })}
                          className="p-1.5 rounded hover:bg-red-100 text-red-600"
                          title="彻底删除"
                        >
                          <Trash2 className="w-3.5 h-3.5" />
                        </button>
                      </div>
                    </div>
                  ))}
                  {deletedPages.map((p) => (
                    <div
                      key={p.id}
                      className="flex items-center justify-between gap-2 py-2 px-3 rounded-lg bg-stone-50 border border-stone-100"
                    >
                      <span className="text-sm text-ink truncate flex-1">{p.title || '未命名'}</span>
                      <span className="text-xs text-ink-muted shrink-0">文档</span>
                      <div className="flex items-center gap-1 shrink-0">
                        <button
                          type="button"
                          onClick={() => onRestorePage(p.id)}
                          className="p-1.5 rounded hover:bg-stone-200 text-ink-muted hover:text-ink"
                          title="恢复"
                        >
                          <RotateCcw className="w-3.5 h-3.5" />
                        </button>
                        <button
                          type="button"
                          onClick={() => setConfirmDelete({ type: 'page', id: p.id })}
                          className="p-1.5 rounded hover:bg-red-100 text-red-600"
                          title="彻底删除"
                        >
                          <Trash2 className="w-3.5 h-3.5" />
                        </button>
                      </div>
                    </div>
                  ))}
                </>
              )}
            </div>
            {/*
              「清空回收站」单独占一行放在底部。
              **不能和右上角的关闭叉挨着** —— 第一版放在标题栏里，量出来两者只隔
              4px，一个是「删光」一个是「关掉」，手指按下去差之毫厘。
              放到底栏之后隔着整个列表的高度，误触基本不可能。
              回收站空的时候整行不出现，免得摆一个点了没用的东西。
            */}
            {trashCount > 0 && (
              <div className="shrink-0 border-t border-paper-border p-2">
                <button
                  type="button"
                  onClick={() => setConfirmDelete({ type: 'all' })}
                  className="w-full rounded-lg py-2 text-sm text-red-600 transition-colors hover:bg-red-50"
                >
                  清空回收站
                </button>
              </div>
            )}
          </div>
        </div>,
        document.body
      )}

      {/* 彻底删除二次确认。同样挂到 body，否则遮罩只盖住侧栏 */}
      {confirmDelete && createPortal(
        <div
          className="fixed inset-0 z-[60] flex items-center justify-center p-4 bg-black/40 kb-safe"
          onClick={() => setConfirmDelete(null)}
        >
          <div
            className="bg-white rounded-xl shadow-xl border border-paper-border p-4 max-w-sm w-full"
            onClick={(e) => e.stopPropagation()}
          >
            <p className="text-sm leading-relaxed text-ink mb-4">
              {confirmDelete.type === 'all'
                ? `确定要清空回收站吗？共 ${trashCount} 项，此操作不可恢复。`
                : '确定要彻底删除吗？此操作不可恢复。'}
            </p>
            <div className="flex justify-end gap-2">
              <button
                type="button"
                onClick={() => setConfirmDelete(null)}
                className="px-3 py-2 rounded-lg text-sm text-ink-muted hover:bg-stone-100"
              >
                取消
              </button>
              <button
                type="button"
                onClick={() => {
                  if (confirmDelete.type === 'all') onEmptyTrash()
                  else if (confirmDelete.type === 'book')
                    onDeleteBookPermanently(confirmDelete.id)
                  else onDeletePagePermanently(confirmDelete.id)
                  setConfirmDelete(null)
                }}
                className="px-3 py-2 rounded-lg text-sm bg-red-600 text-white hover:bg-red-700"
              >
                {confirmDelete.type === 'all' ? '清空' : '彻底删除'}
              </button>
            </div>
          </div>
        </div>,
        document.body
      )}
    </aside>
  )
}

/**
 * 用 memo 包一层：阅读时每一帧滚动都会更新最外层的阅读进度状态，
 * 不隔离的话整棵树（含上千个单词节点）每帧重渲染一次，这正是滚动卡顿的来源。
 * props 没变就跳过渲染。
 */
export const LeftSidebar = memo(LeftSidebarInner)
