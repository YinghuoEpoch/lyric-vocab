import { useState, useCallback, useRef, useEffect } from 'react'
import {
  FolderPlus,
  FileText,
  Book,
  BookOpen,
  Brain,
  MoreHorizontal,
  Pencil,
  Trash2,
  Save,
  FolderOpen,
  RotateCcw,
  X,
  ChevronRight,
  GripVertical,
  Type
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
import { useBackHandler, BackPriority } from '../hooks/useBackHandler'
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
  onRenameBook: (bookId: string, name: string) => void
  onRenamePage: (pageId: string, title: string) => void
  onSelectPage: (page: LyricPage) => void
  onAddPage: (bookId: string) => void
  onExportBackup: () => void
  onRestoreBackup: (file: File) => void
  onReorderBooks: (orderedIds: string[]) => void
  onReorderPages: (entries: Array<{ id: string; bookId: string | null }>) => void
  onImportTxt: (file: File) => void
  readerSettings: ReaderSettings
  onReaderSettingsChange: (s: ReaderSettings) => void
  className?: string
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

export function LeftSidebar({
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
  onRenameBook,
  onRenamePage,
  onSelectPage,
  onAddPage,
  onExportBackup,
  onRestoreBackup,
  onReorderBooks,
  onReorderPages,
  onImportTxt,
  readerSettings,
  onReaderSettingsChange,
  className = ''
}: LeftSidebarProps) {
  const [pageLayout, setPageLayout] = useState<LyricPage[]>(pages)
  const [editing, setEditing] = useState<Editing>(null)
  const [editValue, setEditValue] = useState('')
  const [menuOpen, setMenuOpen] = useState<MenuKind>(null)
  const [recycleOpen, setRecycleOpen] = useState(false)
  const [confirmDelete, setConfirmDelete] = useState<{ type: 'book' | 'page'; id: string } | null>(null)
  const [collapsedBooks, setCollapsedBooks] = useState<Record<string, boolean>>({})
  // 安卓返回键：先关二次确认，再关回收站
  useBackHandler(!!confirmDelete, BackPriority.confirmDelete, () => setConfirmDelete(null))
  useBackHandler(recycleOpen, BackPriority.recycleBin, () => setRecycleOpen(false))

  const [organizeMode, setOrganizeMode] = useState(false)
  const [activeItem, setActiveItem] = useState<ItemKind | null>(null)
  const [dragOverBookId, setDragOverBookId] = useState<string | null>(null)
  const [appearanceOpen, setAppearanceOpen] = useState(false)
  const preEditOpenFoldersRef = useRef<string[] | null>(null)
  const inputRef = useRef<HTMLInputElement>(null)
  const fileInputRef = useRef<HTMLInputElement>(null)
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

  const toggleOrganizeMode = useCallback(() => {
    // 整理模式下不显示「更多」按钮，菜单开着时切进来会连带消失，
    // 状态留着没意义，顺手清掉
    setMenuOpen(null)

    if (!organizeMode) {
      // 进入整理模式：记录当前展开的文件夹，并折叠全部
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
      // 退出整理模式：恢复进入前的展开状态
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
    }
  }, [books, collapsedBooks, organizeMode])

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

  const handleRestoreBackupClick = useCallback(() => {
    fileInputRef.current?.click()
  }, [])

  const handleFileChange = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      const file = e.target.files?.[0]
      if (file) onRestoreBackup(file)
      e.target.value = ''
    },
    [onRestoreBackup]
  )

  const handleTxtFileChange = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      const file = e.target.files?.[0]
      if (file) onImportTxt(file)
      e.target.value = ''
    },
    [onImportTxt]
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

       // 实时乐观更新：文档拖到其他文档或文件夹时，立即调整 pageLayout
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
      const { active, over } = event

      const activeData = active.data.current as ItemKind | undefined
      const overData = over?.data.current as ItemKind | undefined
      if (!activeData) return

      // 文库排序：仅在「文库拖到文库上且位置发生变化」时才更新顺序
      if (
        activeData.type === 'book' &&
        overData?.type === 'book' &&
        active.id !== over?.id
      ) {
        const orderedIds = [...books.map((b) => b.id)]
        const fromIndex = orderedIds.indexOf(activeData.id)
        const toIndex = orderedIds.indexOf(overData.id)
        if (fromIndex !== -1 && toIndex !== -1 && fromIndex !== toIndex) {
          const next = [...orderedIds]
          const [moved] = next.splice(fromIndex, 1)
          next.splice(toIndex, 0, moved)
          onReorderBooks(next)
        }
      }

      // 文档拖拽：
      // - 在拖拽过程中已通过 handleDragOver 实时更新 pageLayout
      // - 这里无论最终落点是文档还是文件夹标题行，统一根据「最终的 pageLayout」持久化顺序
      if (activeData.type === 'page') {
        const entries: Array<{ id: string; bookId: string | null }> = pageLayout
          .filter((p) => !p.deletedAt)
          .map((p) => ({ id: p.id, bookId: p.bookId }))
        onReorderPages(entries)
      }

      setActiveItem(null)
      setDragOverBookId(null)
    },
    [books, pageLayout, onReorderBooks, onReorderPages]
  )

  const renderActiveOverlay = () => {
    if (!activeItem) return null
    if (activeItem.type === 'book') {
      const book = books.find((b) => b.id === activeItem.id)
      if (!book) return null
      return (
        <div className="mb-4">
          <div className="flex items-center gap-1 px-3 py-2.5 rounded-xl bg-white shadow-lg border border-amber-300">
            <ChevronRight className="w-3 h-3 opacity-50" />
            <Book className="w-4 h-4 text-amber-700/80 shrink-0 mt-0.5" />
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
      <div className="px-3 py-2 rounded-lg bg-white shadow-lg border border-amber-300 flex items-center gap-2">
        <FileText
          className={`w-3.5 h-3.5 shrink-0 mt-0.5 ${
            isSelected ? 'text-amber-700' : 'text-ink-muted'
          }`}
        />
        <span
          className={`flex-1 min-w-0 text-sm truncate leading-relaxed ${
            isSelected ? 'text-amber-800 font-medium' : 'text-ink-muted'
          }`}
        >
          {page.title || '未命名'}
        </span>
      </div>
    )
  }

  return (
    <aside className={`w-[250px] h-full shrink-0 border-r border-paper-border bg-white/80 flex flex-col overflow-hidden safe-area-padding ${className}`}>
      <div className="shrink-0 p-3 border-b border-paper-border flex items-center justify-between gap-2">
        <span className="text-sm font-medium text-ink-muted tracking-wide">我的文库</span>
        <div className="flex items-center gap-1">
          <button
            type="button"
            onClick={toggleOrganizeMode}
            className={`px-2 py-1 rounded-lg text-xs font-medium border transition-colors ${
              organizeMode
                ? 'bg-amber-600 border-amber-600 text-white'
                : 'border-stone-300 text-ink-muted hover:bg-stone-100 hover:text-ink'
            }`}
            title="整理文库与文档顺序"
          >
            整理
          </button>
          <button
            type="button"
            onClick={onAddBook}
            className="p-2 rounded-lg hover:bg-stone-100 text-ink-muted hover:text-ink transition-colors"
            title="新建文库"
          >
            <FolderPlus className="w-4 h-4" />
          </button>
        </div>
      </div>

      {/* 双模式切换 */}
      <div className="shrink-0 p-2 border-b border-paper-border">
        <div className="grid grid-cols-2 gap-1 p-1 rounded-lg bg-stone-100">
          <button
            type="button"
            onClick={() => onModeChange('read')}
            className={`flex items-center justify-center gap-1.5 py-2 rounded-md text-sm font-medium transition-colors ${
              mode === 'read' ? 'bg-white text-amber-800 shadow-sm' : 'text-ink-muted hover:text-ink'
            }`}
          >
            <BookOpen className="w-4 h-4" />
            阅读
          </button>
          <button
            type="button"
            onClick={() => onModeChange('review')}
            className={`flex items-center justify-center gap-1.5 py-2 rounded-md text-sm font-medium transition-colors ${
              mode === 'review' ? 'bg-white text-amber-800 shadow-sm' : 'text-ink-muted hover:text-ink'
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
                                ? 'bg-amber-50/90 border border-amber-200/60'
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
                                  isSelected ? 'text-amber-700' : 'text-ink-muted'
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
                                  className="flex-1 min-w-0 px-2 py-1 text-sm rounded-md border border-paper-border bg-paper focus:outline-none focus:ring-2 focus:ring-amber-500/30 focus:border-amber-500 text-ink"
                                  onClick={(e) => e.stopPropagation()}
                                />
                              ) : (
                                <span
                                  className={`flex-1 min-w-0 text-sm truncate leading-relaxed ${
                                    isSelected ? 'text-amber-800 font-medium' : 'text-ink-muted hover:text-ink'
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
                                      className="absolute right-0 top-full mt-1 z-50 min-w-[140px] py-1 rounded-lg border border-paper-border bg-white shadow-lg pointer-events-auto"
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
            items={books.map((b) => b.id)}
            strategy={verticalListSortingStrategy}
          >
            {books.map((book) => {
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
                        } ${bookSelected ? 'bg-amber-50/90 border border-amber-200/60' : ''} ${
                          isDragOver ? 'ring-2 ring-amber-400' : ''
                        }`}
                      >
                        {/* 折叠小三角，仅控制展开/折叠，不触发进入文件夹 */}
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
                        {/* 文件夹文字区域：保持原有点击逻辑 */}
                        <button
                          type="button"
                          onClick={() => !isEditingBook && handleBookClick(book)}
                          className="flex-1 min-w-0 flex items-center gap-2 text-left shrink-0"
                        >
                          {collapsed ? (
                            <Book className="w-4 h-4 text-amber-700/80 shrink-0 mt-0.5" />
                          ) : (
                            <BookOpen className="w-4 h-4 text-amber-700/80 shrink-0 mt-0.5" />
                          )}
                          {isEditingBook ? (
                            <input
                              ref={editing?.type === 'book' ? inputRef : undefined}
                              type="text"
                              value={editValue}
                              onChange={(e) => setEditValue(e.target.value)}
                              onBlur={commitEdit}
                              onKeyDown={handleKeyDown}
                              className="flex-1 min-w-0 px-2 py-1 text-sm rounded-lg border border-paper-border bg-paper focus:outline-none focus:ring-2 focus:ring-amber-500/30 focus:border-amber-500 text-ink"
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
                                  className="absolute right-0 top-full mt-1 z-50 min-w-[140px] py-1 rounded-lg border border-paper-border bg-white shadow-lg pointer-events-auto"
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
                                          ? 'bg-amber-50/90 border border-amber-200/60'
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
                                            isSelected ? 'text-amber-700' : 'text-ink-muted'
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
                                            className="flex-1 min-w-0 px-2 py-1 text-sm rounded-md border border-paper-border bg-paper focus:outline-none focus:ring-2 focus:ring-amber-500/30 focus:border-amber-500 text-ink"
                                            onClick={(e) => e.stopPropagation()}
                                          />
                                        ) : (
                                          <span
                                            className={`flex-1 min-w-0 text-sm truncate leading-relaxed ${
                                              isSelected ? 'text-amber-800 font-medium' : 'text-ink-muted hover:text-ink'
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
                                                className="absolute right-0 top-full mt-1 z-50 min-w-[140px] py-1 rounded-lg border border-paper-border bg-white shadow-lg pointer-events-auto"
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

      {/* 底部：5 个图标按钮严格统一尺寸（同高、同格、同图标大小） */}
      <div className="shrink-0 border-t border-paper-border bg-gray-50">
        <div className="grid grid-cols-5 gap-px">
          <input
            ref={txtFileInputRef}
            type="file"
            accept=".txt,text/plain"
            className="hidden"
            onChange={handleTxtFileChange}
          />
          <input
            ref={fileInputRef}
            type="file"
            accept=".json,application/json"
            className="hidden"
            onChange={handleFileChange}
          />
          <button
            type="button"
            onClick={() => txtFileInputRef.current?.click()}
            className="flex h-11 w-full min-w-0 flex-shrink-0 items-center justify-center text-gray-600 transition-colors hover:bg-gray-100"
            title="导入书籍"
          >
            <FileText className="h-5 w-5 shrink-0" aria-hidden />
          </button>
          <button
            type="button"
            onClick={() => setAppearanceOpen((o) => !o)}
            className={`flex h-11 w-full min-w-0 flex-shrink-0 items-center justify-center transition-colors hover:bg-gray-100 ${
              appearanceOpen ? 'bg-amber-50 text-amber-700' : 'text-gray-600'
            }`}
            title="阅读外观"
          >
            <Type className="h-5 w-5 shrink-0" aria-hidden />
          </button>
          <button
            type="button"
            onClick={onExportBackup}
            className="flex h-11 w-full min-w-0 flex-shrink-0 items-center justify-center text-gray-600 transition-colors hover:bg-gray-100"
            title="导出备份"
          >
            <Save className="h-5 w-5 shrink-0" aria-hidden />
          </button>
          <button
            type="button"
            onClick={handleRestoreBackupClick}
            className="flex h-11 w-full min-w-0 flex-shrink-0 items-center justify-center text-gray-600 transition-colors hover:bg-gray-100"
            title="恢复备份"
          >
            <FolderOpen className="h-5 w-5 shrink-0" aria-hidden />
          </button>
          <button
            type="button"
            onClick={() => setRecycleOpen(true)}
            className="relative flex h-11 w-full min-w-0 flex-shrink-0 items-center justify-center text-gray-600 transition-colors hover:bg-gray-100"
            title="回收站"
          >
            <Trash2 className="h-5 w-5 shrink-0" aria-hidden />
            {trashCount > 0 && (
              <span className="absolute right-1 top-1 flex h-3.5 min-w-[14px] items-center justify-center rounded-full bg-amber-500 px-1 text-[10px] font-medium text-white">
                {trashCount > 99 ? '99+' : trashCount}
              </span>
            )}
          </button>
        </div>
      </div>

      {/* 外观设置 Popover：fixed 脱离侧栏 overflow，避免被裁剪 */}
      {appearanceOpen &&
        createPortal(
          <>
            <div
              className="fixed inset-0 z-40"
              aria-hidden
              onClick={() => setAppearanceOpen(false)}
            />
            <div className="fixed bottom-16 left-4 z-50 w-56 rounded-xl border border-gray-200 bg-white shadow-xl p-3 space-y-3">
              <div className="flex items-center justify-between gap-2">
                <span className="text-xs font-medium text-ink-muted">字号</span>
                <div className="flex items-center gap-1">
                  <button
                    type="button"
                    onClick={() => onReaderSettingsChange({ ...readerSettings, fontSize: Math.max(12, readerSettings.fontSize - 2) })}
                    className="w-8 h-8 rounded-lg border border-stone-200 hover:bg-stone-100 text-ink text-sm font-medium"
                  >
                    −
                  </button>
                  <span className="w-8 text-center text-sm text-ink tabular-nums">{readerSettings.fontSize}</span>
                  <button
                    type="button"
                    onClick={() => onReaderSettingsChange({ ...readerSettings, fontSize: Math.min(24, readerSettings.fontSize + 2) })}
                    className="w-8 h-8 rounded-lg border border-stone-200 hover:bg-stone-100 text-ink text-sm font-medium"
                  >
                    +
                  </button>
                </div>
              </div>
              <div>
                <span className="text-xs font-medium text-ink-muted block mb-1.5">字体</span>
                <div className="flex gap-1">
                  {(['sans', 'serif', 'rounded'] as const).map((f) => (
                    <button
                      key={f}
                      type="button"
                      onClick={() => onReaderSettingsChange({ ...readerSettings, fontFamily: f })}
                      className={`flex-1 py-1.5 rounded-lg text-xs font-medium border transition-colors ${
                        readerSettings.fontFamily === f
                          ? 'border-amber-500 bg-amber-50 text-amber-800'
                          : 'border-stone-200 hover:bg-stone-100 text-ink-muted'
                      }`}
                    >
                      {f === 'sans' ? '无衬线' : f === 'serif' ? '衬线' : '圆体'}
                    </button>
                  ))}
                </div>
              </div>
              <div>
                <span className="text-xs font-medium text-ink-muted block mb-1.5">主题</span>
                <div className="flex gap-1">
                  {(['pure', 'original', 'rice'] as const).map((t) => (
                    <button
                      key={t}
                      type="button"
                      onClick={() => onReaderSettingsChange({ ...readerSettings, theme: t })}
                      className={`flex-1 py-1.5 rounded-lg text-xs font-medium border transition-colors ${
                        readerSettings.theme === t
                          ? 'border-amber-500 bg-amber-50 text-amber-800'
                          : 'border-stone-200 hover:bg-stone-100 text-ink-muted'
                      }`}
                    >
                      {t === 'pure' ? '标准' : t === 'original' ? '青灰' : '暖白'}
                    </button>
                  ))}
                </div>
              </div>
            </div>
          </>,
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
          className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/30"
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
          </div>
        </div>,
        document.body
      )}

      {/* 彻底删除二次确认。同样挂到 body，否则遮罩只盖住侧栏 */}
      {confirmDelete && createPortal(
        <div
          className="fixed inset-0 z-[60] flex items-center justify-center p-4 bg-black/40"
          onClick={() => setConfirmDelete(null)}
        >
          <div
            className="bg-white rounded-xl shadow-xl border border-paper-border p-4 max-w-sm w-full"
            onClick={(e) => e.stopPropagation()}
          >
            <p className="text-sm text-ink mb-4">确定要彻底删除吗？此操作不可恢复。</p>
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
                  if (confirmDelete.type === 'book') onDeleteBookPermanently(confirmDelete.id)
                  else onDeletePagePermanently(confirmDelete.id)
                  setConfirmDelete(null)
                }}
                className="px-3 py-2 rounded-lg text-sm bg-red-600 text-white hover:bg-red-700"
              >
                彻底删除
              </button>
            </div>
          </div>
        </div>,
        document.body
      )}
    </aside>
  )
}
