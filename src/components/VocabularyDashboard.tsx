import { memo, useCallback, useEffect, useState } from 'react'
import { BookOpen, FileText, Eye, EyeOff, Sparkles, GripVertical } from 'lucide-react'
import {
  DndContext,
  closestCenter,
  useSensor,
  useSensors,
  PointerSensor,
  type DragEndEvent
} from '@dnd-kit/core'
import { restrictToWindowEdges } from '@dnd-kit/modifiers'
import { SortableContext, rectSortingStrategy, useSortable, arrayMove } from '@dnd-kit/sortable'
import { CSS } from '@dnd-kit/utilities'
import type { Annotation, AnnotationType, LyricPage, Sentence, WordNote } from '../types'
import { isOrphanAnnotation } from '../types'
import { annotationToSentence } from '../utils/annotationViews'
import { AutoMark } from './AutoMark'
import { getFolderReviewData } from '../hooks/getFolderReviewData'

export type ReviewTarget =
  | { type: 'page'; id: string }
  | { type: 'book'; id: string }
  | null

interface VocabCardItem {
  /**
   * 单篇复习时是标注自己的 id，可以直接拿去排序。
   * 文库复习时是「文档+拼写」拼出来的合并键 —— 那是合并出来的条目，不能排序。
   */
  id: string
  pageId: string
  pageTitle: string
  word: string
  phonetic?: string
  pos?: string
  definition?: string
  /** 原文已删除：正文里已经没有这个词了，但笔记被保留下来 */
  orphaned?: boolean
  /** 由 AI 自动填充，需要复核 */
  auto?: boolean
   // 仅用于文件夹复习模式下的词频统计
  frequency?: number
}

export interface VocabularyDashboardProps {
  reviewTarget: ReviewTarget
  books: { id: string; name: string }[]
  pages: LyricPage[]
  /** 标注表（全部）。组件自己按当前复习范围筛 */
  annotations: Annotation[]
  isEditMode: boolean
  onUpdateWord: (word: string, updates: Partial<WordNote>) => void
  /** 复习模式下编辑句摘（句型/翻译） */
  onUpdateSentence?: (id: string, updates: Partial<Pick<Sentence, 'grammar' | 'meaning'>>) => void
  onVocabCountChange?: (count: number) => void
  /**
   * 调整卡片顺序。只有单篇文档的复习会调用 ——
   * 文库复习的条目是合并出来的，没有对应的标注可写回。
   */
  onReorder?: (docId: string, type: AnnotationType, ids: string[]) => void
  /** 打开「一键填充」对话框；范围就是当前复习的文档或文库 */
  onOpenAutoFill?: () => void
  /** 当前范围内还有多少条空白笔记；为 0 时不显示填充按钮（没什么可填的） */
  autoFillCount?: number
  [key: string]: any
}

function VocabularyDashboardInner({
  reviewTarget,
  pages,
  annotations,
  isEditMode,
  onUpdateWord,
  onUpdateSentence,
  onVocabCountChange,
  onOpenAutoFill,
  autoFillCount = 0,
  onReorder
}: VocabularyDashboardProps) {
  const [hideEnglish, setHideEnglish] = useState(false)
  const [hideChinese, setHideChinese] = useState(false)
  const [reviewMode, setReviewMode] = useState<'vocab' | 'sentence'>('vocab')

  const getPageTitle = (pageId: string) =>
    pages.find((p) => p.id === pageId)?.title || '未命名'

  const getVocabByPage = (pageId: string): VocabCardItem[] => {
    const pageTitle = getPageTitle(pageId)
    return annotations
      .filter((a) => a.docId === pageId && a.type !== 'sentence' && a.text)
      .sort((a, b) => a.order - b.order)
      .map((a) => ({
        id: a.id,
        pageId,
        pageTitle,
        word: a.text,
        phonetic: a.phonetic,
        pos: a.pos,
        definition: a.definition,
        orphaned: isOrphanAnnotation(a) || undefined,
        auto: a.auto
      }))
  }

  const getGroupedVocab = (): { title: string; pageId: string; items: VocabCardItem[] }[] => {
    if (!reviewTarget) return []
    if (reviewTarget.type === 'page') {
      const items = getVocabByPage(reviewTarget.id)
      if (items.length === 0) return []
      return [{ title: getPageTitle(reviewTarget.id), pageId: reviewTarget.id, items }]
    }

    // 文件夹级别复习：按词汇聚合 + 词频统计
    const { high, normal } = getFolderReviewData(reviewTarget.id, pages, annotations)

    const sections: { title: string; pageId: string; items: VocabCardItem[] }[] = []

    if (high.length > 0) {
      sections.push({
        title: '高频 / 重点生词',
        pageId: `${reviewTarget.id}-high`,
        items: high.map((i) => ({
          pageId: i.pageId,
          pageTitle: i.pageTitle,
          id: i.id,
          word: i.word,
          phonetic: i.phonetic,
          pos: i.pos,
          definition: i.definition,
          orphaned: i.orphaned,
          auto: i.auto,
          frequency: i.frequency
        }))
      })
    }

    if (normal.length > 0) {
      sections.push({
        title: '新词 / 普通生词',
        pageId: `${reviewTarget.id}-normal`,
        items: normal.map((i) => ({
          pageId: i.pageId,
          pageTitle: i.pageTitle,
          id: i.id,
          word: i.word,
          phonetic: i.phonetic,
          pos: i.pos,
          definition: i.definition,
          orphaned: i.orphaned,
          auto: i.auto,
          frequency: i.frequency
        }))
      })
    }

    return sections
  }

  type SentenceSection = { title: string; pageId: string; items: Sentence[] }

  const getGroupedSentences = (): SentenceSection[] => {
    if (!reviewTarget) return []
    const sentences = annotations
      .filter((a) => a.type === 'sentence')
      .sort((a, b) => a.order - b.order)
      .map(annotationToSentence)
    if (!sentences.length) return []

    if (reviewTarget.type === 'page') {
      const items = sentences.filter((s) => s.docId === reviewTarget.id)
      if (items.length === 0) return []
      return [{ title: getPageTitle(reviewTarget.id), pageId: reviewTarget.id, items }]
    }
    // 文件夹：该 book 下所有页面的句摘，按文档分组
    const pagesInBook = pages.filter((p) => p.bookId === reviewTarget.id && !p.deletedAt)
    const pageIds = new Set(pagesInBook.map((p) => p.id))
    const filtered = sentences.filter((s) => pageIds.has(s.docId))
    if (filtered.length === 0) return []
    const byPage = new Map<string, Sentence[]>()
    for (const s of filtered) {
      const list = byPage.get(s.docId) ?? []
      list.push(s)
      byPage.set(s.docId, list)
    }
    return pagesInBook
      .filter((p) => (byPage.get(p.id)?.length ?? 0) > 0)
      .map((p) => ({
        title: getPageTitle(p.id),
        pageId: p.id,
        items: byPage.get(p.id)!
      }))
  }

  /**
   * 能不能拖拽排序。
   *
   * 只在「单篇文档 + 编辑模式」下开放：
   * - 文库复习的条目是按拼写合并出来的，拖了没有一条标注可以写回去
   * - 平时不开，免得翻卡片时误拖
   */
  const sortable = isEditMode && reviewTarget?.type === 'page' && !!onReorder

  const sensors = useSensors(
    // 激活阈值很小，安全性来自「必须按住手柄」这一事实（和左侧栏同一套做法）
    useSensor(PointerSensor, { activationConstraint: { distance: 5 } })
  )

  const handleDragEnd = useCallback(
    (event: DragEndEvent, type: AnnotationType, ids: string[]) => {
      const { active, over } = event
      if (!over || active.id === over.id) return
      const from = ids.indexOf(String(active.id))
      const to = ids.indexOf(String(over.id))
      if (from === -1 || to === -1) return
      if (reviewTarget?.type !== 'page') return
      onReorder?.(reviewTarget.id, type, arrayMove(ids, from, to))
    },
    [onReorder, reviewTarget]
  )

  const grouped = getGroupedVocab()
  const groupedSentences = getGroupedSentences()
  const totalCards = grouped.reduce((sum, g) => sum + g.items.length, 0)
  const totalSentenceCards = groupedSentences.reduce((sum, g) => sum + g.items.length, 0)
  const displayCount = reviewMode === 'vocab' ? totalCards : totalSentenceCards

  useEffect(() => {
    onVocabCountChange?.(reviewMode === 'vocab' ? totalCards : totalSentenceCards)
  }, [totalCards, totalSentenceCards, reviewMode, onVocabCountChange])

  if (!reviewTarget) {
    return (
      <div className="flex-1 flex flex-col items-center justify-center text-ink-muted bg-paper">
        <BookOpen className="w-12 h-12 mb-4 opacity-40" />
        <p className="text-sm text-center px-4">在左侧选择文档或文件夹以查看生词</p>
      </div>
    )
  }

  return (
    <div className="flex-1 flex flex-col min-h-0 overflow-hidden bg-paper">
      {/* 背诵遮罩开关 + 词/句切换 */}
      <div className="shrink-0 flex flex-wrap items-center justify-between gap-2 pl-4 pr-3 py-3 border-b border-paper-border bg-white/80">
        <div className="flex flex-wrap items-center gap-2">
          {/* 图标 + 单字，比「隐藏英文」四个字省一半宽度，四种遮罩状态都还在 */}
          <button
            type="button"
            onClick={() => setHideEnglish((v) => !v)}
            title={hideEnglish ? '显示英文' : '隐藏英文'}
            className={`flex items-center gap-1 px-2.5 py-1.5 rounded-lg text-sm font-medium transition-colors ${
              hideEnglish ? 'bg-amber-100 text-amber-800' : 'bg-stone-100 text-ink-muted hover:bg-stone-200'
            }`}
          >
            {hideEnglish ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
            英
          </button>
          <button
            type="button"
            onClick={() => setHideChinese((v) => !v)}
            title={hideChinese ? '显示中文' : '隐藏中文'}
            className={`flex items-center gap-1 px-2.5 py-1.5 rounded-lg text-sm font-medium transition-colors ${
              hideChinese ? 'bg-amber-100 text-amber-800' : 'bg-stone-100 text-ink-muted hover:bg-stone-200'
            }`}
          >
            {hideChinese ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
            中
          </button>
        </div>
        <div className="flex items-center gap-2">
          {/* 全填完之后这个按钮就没用了，直接不显示；显示时顺便报个数 */}
          {onOpenAutoFill && autoFillCount > 0 && (
            <button
              type="button"
              onClick={onOpenAutoFill}
              /* 视觉微调：它和旁边三个按钮尺寸本来完全一致（32px），
                 但实心底色让它读起来像一个「物体」，另外三个只是「文字」，
                 于是显得更大更重。把盒子和图标各收一点，找回平衡。 */
              className="flex items-center gap-1 px-2 py-[5px] rounded-lg text-sm font-medium bg-amber-600 hover:bg-amber-700 text-white transition-colors"
              title={`还有 ${autoFillCount} 条空白笔记，用 AI 补全`}
            >
              <Sparkles className="w-3.5 h-3.5" />
              填充 {autoFillCount}
            </button>
          )}
          <button
            type="button"
            onClick={() => setReviewMode((v) => (v === 'vocab' ? 'sentence' : 'vocab'))}
            className="px-3 py-1.5 rounded-lg text-sm font-medium text-ink-muted hover:bg-stone-100 focus:bg-stone-100 focus:outline-none transition-colors"
          >
            {reviewMode === 'vocab' ? '词' : '句'}
          </button>
        </div>
      </div>

      <div className="flex-1 min-h-0 overflow-y-auto scroll-area p-6">
        {displayCount === 0 ? (
          <div className="flex flex-col items-center justify-center py-16 text-ink-muted">
            <FileText className="w-10 h-10 mb-3 opacity-40" />
            <p className="text-sm">
              {reviewMode === 'vocab' ? '当前没有生词，先去阅读并标记单词吧' : '当前没有句摘，先去阅读并保存句子吧'}
            </p>
          </div>
        ) : reviewMode === 'vocab' ? (
          <div className="space-y-8 max-w-5xl mx-auto">
            {grouped.map((group) => (
              <section key={group.pageId}>
                <h2 className="text-sm font-medium text-ink-muted mb-3 flex items-center gap-2">
                  <FileText className="w-4 h-4" />
                  {group.title}
                  <span className="text-xs font-normal text-gray-400">({group.items.length})</span>
                </h2>
                <CardGrid
                  sortable={sortable}
                  sensors={sensors}
                  ids={group.items.map((i) => i.id)}
                  onDragEnd={(e) => handleDragEnd(e, 'word', group.items.map((i) => i.id))}
                >
                  {group.items.map((item) => (
                    <SortableCard key={item.id} id={item.id} sortable={sortable}>
                      {(handle) => (
                        <VocabCard
                          item={item}
                          hideEnglish={hideEnglish}
                          hideChinese={hideChinese}
                          isEditMode={isEditMode}
                          onUpdateWord={onUpdateWord}
                          dragHandle={handle}
                        />
                      )}
                    </SortableCard>
                  ))}
                </CardGrid>
              </section>
            ))}
          </div>
        ) : (
          <div className="space-y-8 max-w-5xl mx-auto">
            {groupedSentences.map((group) => (
              <section key={group.pageId}>
                <h2 className="text-sm font-medium text-ink-muted mb-3 flex items-center gap-2">
                  <FileText className="w-4 h-4" />
                  {group.title}
                  <span className="text-xs font-normal text-gray-400">({group.items.length})</span>
                </h2>
                <CardGrid
                  sortable={sortable}
                  sensors={sensors}
                  ids={group.items.map((i) => i.id)}
                  onDragEnd={(e) => handleDragEnd(e, 'sentence', group.items.map((i) => i.id))}
                >
                  {group.items.map((item) => (
                    <SortableCard key={item.id} id={item.id} sortable={sortable}>
                      {(handle) => (
                        <SentenceCard
                          item={item}
                          hideEnglish={hideEnglish}
                          hideChinese={hideChinese}
                          isEditMode={isEditMode}
                          onUpdateSentence={onUpdateSentence}
                          dragHandle={handle}
                        />
                      )}
                    </SortableCard>
                  ))}
                </CardGrid>
              </section>
            ))}
          </div>
        )}
      </div>
    </div>
  )
}

const GRID_CLASS = 'grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4'

/** 卡片网格。不能排序时就是个普通网格，连 DndContext 都不挂 */
function CardGrid({
  sortable,
  sensors,
  ids,
  onDragEnd,
  children
}: {
  sortable: boolean
  sensors: ReturnType<typeof useSensors>
  ids: string[]
  onDragEnd: (event: DragEndEvent) => void
  children: React.ReactNode
}) {
  if (!sortable) return <div className={GRID_CLASS}>{children}</div>
  return (
    <DndContext
      sensors={sensors}
      collisionDetection={closestCenter}
      modifiers={[restrictToWindowEdges]}
      onDragEnd={onDragEnd}
    >
      {/* 卡片是网格排布，用 rectSortingStrategy；竖列那套策略在这里会算错位置 */}
      <SortableContext items={ids} strategy={rectSortingStrategy}>
        <div className={GRID_CLASS}>{children}</div>
      </SortableContext>
    </DndContext>
  )
}

/**
 * 可拖动的卡片外壳。
 *
 * 手柄以 children 参数的形式交给卡片自己去摆 —— 卡片内部的排版各不相同，
 * 外面用绝对定位去盖，迟早会和某个输入框撞上。
 */
function SortableCard({
  id,
  sortable,
  children
}: {
  id: string
  sortable: boolean
  children: (handle: React.ReactNode) => React.ReactNode
}) {
  if (!sortable) return <>{children(null)}</>
  return <SortableCardInner id={id}>{children}</SortableCardInner>
}

function SortableCardInner({
  id,
  children
}: {
  id: string
  children: (handle: React.ReactNode) => React.ReactNode
}) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({ id })

  const style: React.CSSProperties = {
    transform: CSS.Transform.toString(transform),
    transition,
    zIndex: isDragging ? 999 : undefined,
    opacity: isDragging ? 0.4 : 1
  }

  const handle = (
    <button
      type="button"
      className="shrink-0 -ml-1 p-1 rounded text-stone-300 hover:text-ink cursor-grab active:cursor-grabbing"
      style={{ touchAction: 'none' }}
      aria-label="拖动调整顺序"
      {...attributes}
      {...listeners}
    >
      <GripVertical className="w-4 h-4" />
    </button>
  )

  return (
    <div ref={setNodeRef} style={style}>
      {children(handle)}
    </div>
  )
}

function VocabCard({
  item,
  hideEnglish,
  hideChinese,
  isEditMode,
  onUpdateWord,
  dragHandle
}: {
  item: VocabCardItem
  hideEnglish: boolean
  hideChinese: boolean
  isEditMode: boolean
  onUpdateWord: (word: string, updates: Partial<WordNote>) => void
  dragHandle?: React.ReactNode
}) {
  // 遮住答案时，点一下卡片翻开 / 再点一下盖回去（触摸屏没有 hover，只能靠点）
  const [revealed, setRevealed] = useState(false)
  const showEnglish = !hideEnglish || revealed
  const showChinese = !hideChinese || revealed
  const [localPos, setLocalPos] = useState(item.pos ?? '')
  const [localPhonetic, setLocalPhonetic] = useState(item.phonetic ?? '')
  const [localDefinition, setLocalDefinition] = useState(item.definition ?? '')

  useEffect(() => {
    setLocalPos(item.pos ?? '')
    setLocalPhonetic(item.phonetic ?? '')
    setLocalDefinition(item.definition ?? '')
  }, [item.word, item.pos, item.phonetic, item.definition])

  const handleSave = () => {
    const nextPos = localPos.trim() || undefined
    const nextPhonetic = localPhonetic.trim() || undefined
    const nextDef = localDefinition.trim() || undefined

    if (nextPos === item.pos && nextPhonetic === item.phonetic && nextDef === item.definition) return

    onUpdateWord(item.word, {
      pos: nextPos,
      phonetic: nextPhonetic,
      definition: nextDef
    })
  }

  return (
    <div
      className="rounded-xl border border-stone-200 bg-white p-4 shadow-sm transition-all min-h-[100px]"
      onClick={(e) => {
        // 点在输入框 / 按钮上时不要连带翻开答案
        if ((e.target as HTMLElement).closest('input, textarea, button, select, a')) return
        setRevealed((v) => !v)
      }}
    >
      <div className="flex items-start justify-between gap-2 flex-wrap">
        {dragHandle}
        <div className="min-w-0 flex-1 min-h-[28px]">
          {showEnglish ? (
            <span className="font-lyric-en font-serif text-amber-800 font-bold text-lg block">
              {item.word}
              {item.auto && <AutoMark />}
            </span>
          ) : (
            <span className="text-ink-muted/70 text-sm">
              点击显示英文
            </span>
          )}
          {item.orphaned && (
            <span
              className="inline-block mt-1 px-2 py-0.5 rounded-full bg-stone-100 text-ink-muted text-xs font-medium border border-stone-300/70"
              title="正文里已经没有这个词了，笔记被保留下来"
            >
              原文已删除
            </span>
          )}
        </div>
        <div className="flex flex-col items-end gap-1">
          {isEditMode ? (
            <input
              type="text"
              className="shrink-0 w-16 px-2 py-0.5 rounded-full bg-stone-100 text-ink text-xs font-medium border border-stone-200 focus:outline-none focus:ring-1 focus:ring-amber-400"
              placeholder="词性"
              value={localPos}
              onChange={(e) => setLocalPos(e.target.value)}
              onBlur={handleSave}
            />
          ) : (
            item.pos &&
            showEnglish && (
              <span className="shrink-0 px-2 py-0.5 rounded-full bg-stone-200/80 text-ink text-xs font-medium">
                {item.pos}
              </span>
            )
          )}
          {showEnglish && item.frequency && item.frequency > 1 && (
            <span className="inline-flex items-center justify-center rounded-full bg-amber-100 text-amber-800 text-[11px] px-1.5 py-0.5">
              {item.frequency}
            </span>
          )}
        </div>
      </div>
      {isEditMode ? (
        <input
          type="text"
          className="mt-1 w-full max-w-[12rem] text-sm text-ink-muted italic font-mono rounded-md border border-stone-200 px-2 py-0.5 bg-stone-50 focus:outline-none focus:ring-1 focus:ring-amber-400"
          placeholder="音标"
          value={localPhonetic}
          onChange={(e) => setLocalPhonetic(e.target.value)}
          onBlur={handleSave}
        />
      ) : showEnglish && item.phonetic ? (
        <span className="text-sm text-ink-muted italic font-mono mt-1 block">
          {item.phonetic}
        </span>
      ) : null}
      {(isEditMode || item.definition) && (
        <div className="mt-2 pt-2 border-t border-stone-100 min-h-[32px]">
          {isEditMode ? (
            <textarea
              className="w-full text-sm text-ink-muted leading-snug rounded-md border border-stone-200 px-2 py-1 resize-none focus:outline-none focus:ring-1 focus:ring-amber-400"
              rows={3}
              placeholder="输入或编辑释义 / 备注"
              value={localDefinition}
              onChange={(e) => setLocalDefinition(e.target.value)}
              onBlur={handleSave}
            />
          ) : showChinese ? (
            <span className="text-sm text-ink-muted leading-snug block">
              {item.definition}
            </span>
          ) : (
            <span className="text-ink-muted/60 text-xs">
              点击显示释义
            </span>
          )}
        </div>
      )}
    </div>
  )
}

function SentenceCard({
  item,
  hideEnglish,
  hideChinese,
  isEditMode,
  onUpdateSentence,
  dragHandle
}: {
  item: Sentence
  hideEnglish: boolean
  hideChinese: boolean
  isEditMode: boolean
  onUpdateSentence?: (id: string, updates: Partial<Pick<Sentence, 'grammar' | 'meaning'>>) => void
  dragHandle?: React.ReactNode
}) {
  // 遮住答案时，点一下卡片翻开 / 再点一下盖回去（触摸屏没有 hover，只能靠点）
  const [revealed, setRevealed] = useState(false)
  const showEnglish = !hideEnglish || revealed
  const showChinese = !hideChinese || revealed
  const [localGrammar, setLocalGrammar] = useState(item.grammar ?? '')
  const [localMeaning, setLocalMeaning] = useState(item.meaning ?? '')

  useEffect(() => {
    setLocalGrammar(item.grammar ?? '')
    setLocalMeaning(item.meaning ?? '')
  }, [item.id, item.grammar, item.meaning])

  const handleSave = () => {
    const nextGrammar = localGrammar.trim()
    const nextMeaning = localMeaning.trim()
    if (nextGrammar === (item.grammar ?? '') && nextMeaning === (item.meaning ?? '')) return
    onUpdateSentence?.(item.id, { grammar: nextGrammar, meaning: nextMeaning })
  }

  return (
    <div
      className="rounded-xl border border-stone-200 bg-white p-4 shadow-sm transition-all min-h-[100px]"
      onClick={(e) => {
        // 点在输入框 / 按钮上时不要连带翻开答案
        if ((e.target as HTMLElement).closest('input, textarea, button, select, a')) return
        setRevealed((v) => !v)
      }}
    >
      <div className="min-h-[28px] flex items-start gap-1">
        {dragHandle}
        {showEnglish ? (
          <p className="font-lyric-en font-serif text-amber-800 text-base leading-snug flex-1">
            {item.text}
            {item.auto && <AutoMark />}
          </p>
        ) : (
          <span className="text-ink-muted/70 text-sm">
            点击显示英文
          </span>
        )}
      </div>
      {isEditMode ? (
        <>
          <input
            type="text"
            className="mt-1 w-full h-8 px-2 py-1 text-sm rounded-md border border-stone-200 bg-stone-50/80 text-ink placeholder-stone-400 focus:outline-none focus:ring-1 focus:ring-amber-400 focus:border-amber-500"
            placeholder="句型/语法"
            value={localGrammar}
            onChange={(e) => setLocalGrammar(e.target.value)}
            onBlur={handleSave}
          />
          <div className="mt-2 pt-2 border-t border-stone-100 min-h-[32px]">
            <textarea
              className="w-full text-sm text-ink-muted leading-snug rounded-md border border-stone-200 px-2 py-1 resize-none focus:outline-none focus:ring-1 focus:ring-amber-400 placeholder-stone-400"
              rows={3}
              placeholder="翻译/释义"
              value={localMeaning}
              onChange={(e) => setLocalMeaning(e.target.value)}
              onBlur={handleSave}
            />
          </div>
        </>
      ) : (
        <>
          {item.grammar && showEnglish && (
            <p className="mt-1 text-sm text-stone-500 font-sans">{item.grammar}</p>
          )}
          {(item.meaning || !showChinese) && (
            <div className="mt-2 pt-2 border-t border-stone-100 min-h-[32px]">
              {showChinese && item.meaning ? (
                <span className="text-sm text-ink-muted leading-snug block">{item.meaning}</span>
              ) : (
                <span className="text-ink-muted/60 text-xs">
                  点击显示翻译
                </span>
              )}
            </div>
          )}
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
export const VocabularyDashboard = memo(VocabularyDashboardInner)
