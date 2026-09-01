import { memo, useCallback, useEffect, useRef, useState } from 'react'
import { BookOpen, FileText, Eye, EyeOff, Sparkles, GripVertical, X } from 'lucide-react'
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
import type { Annotation, AnnotationGroup, LyricPage, Sentence, WordNote } from '../types'
import { isOrphanAnnotation } from '../types'
import { annotationToSentence } from '../utils/annotationViews'
import { AutoMark } from './AutoMark'
import { BAND_SUB } from './chrome'
import { EditedMark } from './EditedMark'
import { AutoTextarea } from './AutoTextarea'
import { getFolderReviewData } from '../hooks/getFolderReviewData'
import { useSpeak } from '../hooks/useSpeak'
import { usePrefetchAudio } from '../hooks/usePrefetchAudio'
import { SwipeToDelete } from './SwipeToDelete'

export type ReviewTarget =
  | { type: 'page'; id: string }
  | { type: 'book'; id: string }
  | null

interface VocabCardItem {
  /** 单词还是短语。短语的卡片不显示音标/词性，改显示「用法」 */
  kind: 'word' | 'phrase'
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
  /** 短语的用法 / 搭配说明。存在标注的 grammar 字段里 */
  usage?: string
  /** 原文已删除：正文里已经没有这个词了，但笔记被保留下来 */
  orphaned?: boolean
  /** 短语才会有：正文改过、它跟着变短或错位了，这里是当初划的那一段 */
  sourceText?: string
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
  onUpdateWord: (word: string, updates: Partial<WordNote> & { grammar?: string }) => void
  /** 复习模式下编辑句摘（句型/翻译） */
  onUpdateSentence?: (id: string, updates: Partial<Pick<Sentence, 'grammar' | 'meaning'>>) => void
  onVocabCountChange?: (count: number) => void
  /**
   * 调整卡片顺序。只有单篇文档的复习会调用 ——
   * 文库复习的条目是合并出来的，没有对应的标注可写回。
   */
  onReorder?: (docId: string, group: AnnotationGroup, ids: string[]) => void
  /**
   * 删除一条笔记（左滑露出的那颗按钮）。
   *
   * 和拖拽排序同一个范围：**只在单篇文档的复习里**。文库复习的卡片是按拼写
   * 合并出来的，一张卡背后可能是好几条标注，滑掉它等于一次删好几条。
   */
  onDeleteAnnotation?: (id: string) => void
  /** 打开「一键填充」对话框；范围就是当前复习的文档或文库 */
  onOpenAutoFill?: () => void
  /** 填充弹窗是否开着：开着时这颗按钮保持「按下」的样子（仅限没有空白卡片那一档）*/
  autoFillOpen?: boolean
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
  autoFillOpen = false,
  autoFillCount = 0,
  onReorder,
  onDeleteAnnotation
}: VocabularyDashboardProps) {
  const [hideEnglish, setHideEnglish] = useState(false)
  const [hideChinese, setHideChinese] = useState(false)
  const [reviewMode, setReviewMode] = useState<'vocab' | 'sentence'>('vocab')
  /** 左滑露出删除的那张卡。同时只开一张，不然满屏都是红按钮 */
  const [swipedId, setSwipedId] = useState<string | null>(null)

  /**
   * 点词 / 点句读出来。这台手机不支持朗读时 canSpeak 为 false，喇叭就不画。
   * 必须放在所有提前 return 之前 —— 钩子数量一旦忽多忽少，React 直接报错白屏。
   */
  const { canSpeak, speakingId, speak, error: speechError, installVoice, dismissError } = useSpeak()

  const getPageTitle = (pageId: string) =>
    pages.find((p) => p.id === pageId)?.title || '未命名'

  const getVocabByPage = (pageId: string): VocabCardItem[] => {
    const pageTitle = getPageTitle(pageId)
    return annotations
      .filter((a) => a.docId === pageId && a.type !== 'sentence' && a.text)
      .sort((a, b) => a.order - b.order)
      .map((a) => ({
        id: a.id,
        kind: a.type === 'phrase' ? ('phrase' as const) : ('word' as const),
        pageId,
        pageTitle,
        word: a.text,
        phonetic: a.phonetic,
        pos: a.pos,
        definition: a.definition,
        usage: a.grammar,
        sourceText: a.sourceText,
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
          kind: i.kind,
          pageId: i.pageId,
          pageTitle: i.pageTitle,
          id: i.id,
          word: i.word,
          phonetic: i.phonetic,
          pos: i.pos,
          definition: i.definition,
          usage: i.usage,
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
          kind: i.kind,
          pageId: i.pageId,
          pageTitle: i.pageTitle,
          id: i.id,
          word: i.word,
          phonetic: i.phonetic,
          pos: i.pos,
          definition: i.definition,
          usage: i.usage,
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
  /**
   * 能不能左滑删除。
   *
   * **编辑模式内外都给。** 一开始只在编辑模式里，结果真机上很难划出来 ——
   * 那时候卡片正中间整条带子是输入框。挡输入框那条后来收窄了，
   * 但**非编辑模式下压根没有输入框**，那边天生就顺手，没有理由不给。
   *
   * 「文库复习不给」这条**保留**：那边一张卡是按拼写把好几条标注合并出来的，
   * 删它等于一次删好几条，而且看不见删了哪几条。和拖拽排序在那边被禁掉同一个理由。
   */
  const swipable = reviewTarget?.type === 'page' && !!onDeleteAnnotation

  const sensors = useSensors(
    // 激活阈值很小，安全性来自「必须按住手柄」这一事实（和左侧栏同一套做法）
    useSensor(PointerSensor, { activationConstraint: { distance: 5 } })
  )

  const handleDragEnd = useCallback(
    (event: DragEndEvent, group: AnnotationGroup, ids: string[]) => {
      const { active, over } = event
      if (!over || active.id === over.id) return
      const from = ids.indexOf(String(active.id))
      const to = ids.indexOf(String(over.id))
      if (from === -1 || to === -1) return
      if (reviewTarget?.type !== 'page') return
      onReorder?.(reviewTarget.id, group, arrayMove(ids, from, to))
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

  // 退出编辑模式、换一篇、切到句摘那边：滑开的那张收回去，
  // 不然红按钮会一直挂在那儿，下次进来还开着
  useEffect(() => {
    setSwipedId(null)
  }, [isEditMode, reviewTarget?.id, reviewMode])

  /**
   * 这一页的发音先悄悄备好，省掉每个词第一次点时等开口的那半秒。
   * 和上面那个 useEffect 一样，必须待在提前 return 之前。
   */
  usePrefetchAudio(
    grouped.flatMap((g) => g.items.map((i) => i.word)),
    canSpeak && reviewMode === 'vocab'
  )

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
      <div className={`${BAND_SUB} flex-wrap bg-white/80`}>
        <div className="flex flex-wrap items-center gap-2">
          {/* 图标 + 单字，比「隐藏英文」四个字省一半宽度，四种遮罩状态都还在 */}
          <button
            type="button"
            onClick={() => setHideEnglish((v) => !v)}
            title={hideEnglish ? '显示英文' : '隐藏英文'}
            /*
              **这一行一个实心块都不留。**
              带只有 40px，塞一个 32px 的实心块进去上下就各剩 4px —— 竖着看很堵，
              而且不分开着关着：底色一填就堵。所以状态不再靠「填一块底色」表达。

              开着 = 琥珀色的字 + 图标从「睁眼」换成「闭眼」，两个信号叠在一起，
              比一块底色更好认，还不占竖向空间。
              （和两个侧栏拆掉「盒中盒」是同一件事，这一行是最后一处。）
            */
            className={`flex items-center gap-1 px-2 py-1 rounded-lg text-sm font-medium transition-colors hover:bg-stone-100 ${
              hideEnglish ? 'text-amber-700' : 'text-ink-muted'
            }`}
          >
            {hideEnglish ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
            英
          </button>
          <button
            type="button"
            onClick={() => setHideChinese((v) => !v)}
            title={hideChinese ? '显示中文' : '隐藏中文'}
            className={`flex items-center gap-1 px-2 py-1 rounded-lg text-sm font-medium transition-colors hover:bg-stone-100 ${
              hideChinese ? 'text-amber-700' : 'text-ink-muted'
            }`}
          >
            {hideChinese ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
            中
          </button>
        </div>
        <div className="flex items-center gap-2">
          {/* 常驻按钮。数的是「还有格子空着」的笔记，单词和句子一起算。
              全填完了也留着 —— 一来位置固定，不会今天在明天不在；
              二来「AI 设置」只有这条路进得去，从前全填完就再也改不了 Key 了。
              没得可填时收成一枚安静的图标，与旁边的「词/句」同一等级，
              有得可填才亮成实心并报数。 */}
          {onOpenAutoFill && (
            <button
              type="button"
              onClick={onOpenAutoFill}
              /*
                **整块琥珀底去掉了。** 它是这一行里最重的一块 —— 30px 的实心块塞在
                40px 的带里上下各剩 5px，用户说的「显挤」主要就是它。

                但「还差几条没填全」这个信号不能丢，所以搬到一枚**小圆点**上：
                圆点只有 18px，在 40px 的带里绰绰有余，而它是整行唯一的实心色块，
                反倒比从前一整块琥珀更抓眼（从前旁边还有英、中两块底色跟它抢）。

                按下去的反馈和「弹窗开着一直亮」都还在，只是都改成文字变色，
                不再靠填底色（`hover:` 这个变体已经被改成「悬停 **或** 正按着」，
                见 tailwind.config.js）。
              */
              className={`flex items-center gap-1 px-2 py-1 rounded-lg text-sm font-medium transition-colors hover:bg-stone-100 hover:text-amber-700 ${
                autoFillCount > 0 || autoFillOpen ? 'text-amber-700' : 'text-ink-muted'
              }`}
              title={
                autoFillCount > 0
                  ? `还有 ${autoFillCount} 条笔记没填全，让 AI 只补空着的格子`
                  : '笔记都填全了；点开可以改 AI 设置'
              }
            >
              <Sparkles className="w-3.5 h-3.5 shrink-0" />
              {/*
                写「AI 填充」不写「填充」：和生词板那颗「AI 划词」凑成一对，
                两个 AI 功能一眼看得出是同一类。（划词那颗见第二十二节 ——
                它从前是个没有文字的图标，手机上等于哑谜。）
                量过：375px 窄屏上这一排左右两组之间空着 123px，
                多出来的「AI 」只占 17px，带上数字最坏也只多 39px，不会挤到第二行。
              */}
              AI 填充
              {autoFillCount > 0 && (
                <span className="ml-0.5 inline-flex h-[18px] min-w-[18px] items-center justify-center rounded-full bg-amber-600 px-1 text-[11px] font-medium leading-none text-white">
                  {autoFillCount}
                </span>
              )}
            </button>
          )}
          <button
            type="button"
            onClick={() => setReviewMode((v) => (v === 'vocab' ? 'sentence' : 'vocab'))}
            className="px-2 py-1 rounded-lg text-sm font-medium text-ink-muted hover:bg-stone-100 focus:bg-stone-100 focus:outline-none transition-colors"
          >
            {reviewMode === 'vocab' ? '词' : '句'}
          </button>
        </div>
      </div>

      {speechError && (
        <div className="shrink-0 flex items-start gap-2 px-4 py-2 bg-amber-50 border-b border-amber-200 text-xs text-amber-900 leading-relaxed">
          <span className="flex-1 break-words">{speechError.message}</span>
          {speechError.missingVoice && installVoice && (
            <button
              type="button"
              onClick={installVoice}
              className="shrink-0 px-2 py-0.5 rounded border border-amber-300 hover:bg-amber-100 font-medium"
            >
              去安装
            </button>
          )}
          <button
            type="button"
            onClick={dismissError}
            aria-label="知道了"
            className="p-0.5 rounded hover:bg-amber-100"
          >
            <X className="w-3.5 h-3.5" />
          </button>
        </div>
      )}

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
                  onDragEnd={(e) => handleDragEnd(e, 'vocab', group.items.map((i) => i.id))}
                >
                  {group.items.map((item) => (
                    <SortableCard key={item.id} id={item.id} sortable={sortable}>
                      {(handle) => (
                        <MaybeSwipe
                          swipable={swipable}
                          id={item.id}
                          deleteLabel={`删除「${item.word}」这条笔记`}
                          openId={swipedId}
                          onOpenIdChange={setSwipedId}
                          onDelete={(id) => onDeleteAnnotation?.(id)}
                        >
                          <VocabCard
                            item={item}
                            hideEnglish={hideEnglish}
                            hideChinese={hideChinese}
                            isEditMode={isEditMode}
                            onUpdateWord={onUpdateWord}
                            dragHandle={handle}
                            canSpeak={canSpeak}
                            speaking={speakingId === item.id}
                            onSpeak={() => speak(item.id, item.word, { lookup: true })}
                          />
                        </MaybeSwipe>
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
                        <MaybeSwipe
                          swipable={swipable}
                          id={item.id}
                          deleteLabel="删除这条句摘"
                          openId={swipedId}
                          onOpenIdChange={setSwipedId}
                          onDelete={(id) => onDeleteAnnotation?.(id)}
                        >
                          <SentenceCard
                            item={item}
                            hideEnglish={hideEnglish}
                            hideChinese={hideChinese}
                            isEditMode={isEditMode}
                            onUpdateSentence={onUpdateSentence}
                            dragHandle={handle}
                            canSpeak={canSpeak}
                            speaking={speakingId === item.id}
                            onSpeak={() => speak(item.id, item.text)}
                          />
                        </MaybeSwipe>
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

/**
 * 可朗读的那段英文：文字本身就是按钮，点一下读出来。
 *
 * **不放喇叭图标** —— 试过一版，摆在哪条中线上都别扭，
 * 而正在念的时候文字会变色，反馈已经够了。
 * 读不了的手机（没装朗读引擎）直接退回普通文字，不摆一个按了没反应的按钮。
 */
function SpeakButton({
  canSpeak,
  speaking,
  onSpeak,
  label,
  className,
  children
}: {
  canSpeak: boolean
  speaking: boolean
  onSpeak: () => void
  label: string
  className: string
  children: React.ReactNode
}) {
  if (!canSpeak) return <span className={`${className} text-amber-800`}>{children}</span>

  return (
    <button
      type="button"
      onClick={onSpeak}
      aria-label={label}
      title={label}
      className={`${className} transition-colors ${speaking ? 'text-amber-500' : 'text-amber-800'}`}
    >
      {children}
    </button>
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
 * 可滑就套一层，不可滑就原样放行。
 *
 * 不做成「一直套着、靠 props 关掉」—— 那样非编辑模式下每张卡都白白多两层 div
 * 和一串指针事件监听，一页上百张卡不划算。
 */
function MaybeSwipe({
  swipable,
  id,
  deleteLabel,
  openId,
  onOpenIdChange,
  onDelete,
  children
}: {
  swipable: boolean
  id: string
  deleteLabel: string
  openId: string | null
  onOpenIdChange: (id: string | null) => void
  onDelete: (id: string) => void
  children: React.ReactNode
}) {
  if (!swipable) return <>{children}</>
  return (
    <SwipeToDelete
      open={openId === id}
      onOpenChange={(open) => onOpenIdChange(open ? id : null)}
      onDelete={() => onDelete(id)}
      deleteLabel={deleteLabel}
    >
      {children}
    </SwipeToDelete>
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
      // 手柄有自己的手势，左滑删除那层要放它过去（见 SwipeToDelete）
      data-no-swipe=""
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
  dragHandle,
  canSpeak,
  speaking,
  onSpeak
}: {
  item: VocabCardItem
  hideEnglish: boolean
  hideChinese: boolean
  isEditMode: boolean
  onUpdateWord: (word: string, updates: Partial<WordNote> & { grammar?: string }) => void
  dragHandle?: React.ReactNode
  canSpeak: boolean
  speaking: boolean
  onSpeak: () => void
}) {
  // 遮住答案时，点一下卡片翻开 / 再点一下盖回去（触摸屏没有 hover，只能靠点）
  const [revealed, setRevealed] = useState(false)
  const showEnglish = !hideEnglish || revealed
  const showChinese = !hideChinese || revealed
  const isPhrase = item.kind === 'phrase'
  const [localPos, setLocalPos] = useState(item.pos ?? '')
  const [localPhonetic, setLocalPhonetic] = useState(item.phonetic ?? '')
  const [localDefinition, setLocalDefinition] = useState(item.definition ?? '')
  const [localUsage, setLocalUsage] = useState(item.usage ?? '')

  useEffect(() => {
    setLocalPos(item.pos ?? '')
    setLocalPhonetic(item.phonetic ?? '')
    setLocalDefinition(item.definition ?? '')
    setLocalUsage(item.usage ?? '')
  }, [item.word, item.pos, item.phonetic, item.definition, item.usage])

  const handleSave = () => {
    const nextPos = localPos.trim() || undefined
    const nextPhonetic = localPhonetic.trim() || undefined
    const nextDef = localDefinition.trim() || undefined
    const nextUsage = localUsage.trim() || undefined

    // 短语没有音标和词性那两格，别把它们连带写成空
    if (isPhrase) {
      if (nextDef === item.definition && nextUsage === item.usage) return
      onUpdateWord(item.word, { definition: nextDef, grammar: nextUsage })
      return
    }

    if (nextPos === item.pos && nextPhonetic === item.phonetic && nextDef === item.definition) return

    onUpdateWord(item.word, {
      pos: nextPos,
      phonetic: nextPhonetic,
      definition: nextDef
    })
  }

  /**
   * 离开编辑模式（或卡片被卸掉）时，把还没提交的改动落下去。
   *
   * 从前**只有 onBlur 一个触发点**。手机上改完直接点铅笔退出时，
   * 输入框往往还没来得及失焦就被换掉了，那次改动就这么悄悄没了 ——
   * 数据没存，AI 角标自然也不会消失。
   * 这里用「进编辑模式时登记、离开时执行」的清理函数兜住，
   * 不管失焦事件来不来都保得住。
   */
  const saveRef = useRef(handleSave)
  saveRef.current = handleSave
  useEffect(() => {
    if (!isEditMode) return
    return () => saveRef.current()
  }, [isEditMode])

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
            /* 点单词 = 读出来；卡片别处照旧是「翻开答案」。
               外层那个 onClick 本来就跳过 button，两件事不会打架 */
            <span className="block">
              <SpeakButton
                canSpeak={canSpeak}
                speaking={speaking}
                onSpeak={onSpeak}
                label={`朗读 ${item.word}`}
                className="font-lyric-en font-serif font-bold text-lg text-left"
              >
                {item.word}
                {item.auto && <AutoMark />}
              </SpeakButton>
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
          {/* 只有短语会「变短」—— 单词标注就一个词，要么在要么没了 */}
          {item.sourceText && !item.orphaned && showEnglish && (
            <span className="mt-1 flex flex-wrap items-center gap-1.5">
              <EditedMark sourceText={item.sourceText} expanded={revealed || !hideEnglish} />
            </span>
          )}
        </div>
        <div className="flex flex-col items-end gap-1">
          {isPhrase ? (
            showEnglish && (
              <span className="shrink-0 px-2 py-0.5 rounded-full bg-amber-100 text-amber-800 text-xs font-medium">
                短语
              </span>
            )
          ) : isEditMode ? (
            /* 保持阅读态那颗药丸的样子，宽度跟着内容走 */
            <span className="pos-fit shrink-0" data-value={localPos || '词性'}>
              <input
                type="text"
                /* size=1 是关键：不设的话输入框自带约 180px 的固有宽度，
                   会把外层网格整个撑开，药丸就不再跟着内容收缩了 */
                size={1}
                className="field-pos"
                placeholder="词性"
                aria-label="词性"
                value={localPos}
                onChange={(e) => setLocalPos(e.target.value)}
                onBlur={handleSave}
              />
            </span>
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
      {isPhrase ? null : isEditMode ? (
        /* 类名和下面阅读态那一行保持一致，两种模式看起来才是同一行字 */
        <input
          type="text"
          className="field-inline text-sm text-ink-muted italic font-mono mt-1"
          placeholder="音标"
          aria-label="音标"
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
            <AutoTextarea
              className="field-inline text-sm text-ink-muted leading-snug"
              placeholder="释义 / 备注"
              aria-label="释义"
              value={localDefinition}
              onChange={setLocalDefinition}
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
      {/* 短语专有的第二格：用法 / 搭配。单词卡不显示这一行 */}
      {isPhrase && (isEditMode || item.usage) && (
        <div className="mt-2 min-h-[24px]">
          {isEditMode ? (
            <AutoTextarea
              className="field-inline text-sm text-stone-500 font-sans leading-snug"
              placeholder="用法 / 搭配"
              aria-label="短语用法"
              value={localUsage}
              onChange={setLocalUsage}
              onBlur={handleSave}
            />
          ) : showChinese ? (
            <span className="text-sm text-stone-500 leading-snug block">{item.usage}</span>
          ) : null}
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
  dragHandle,
  canSpeak,
  speaking,
  onSpeak
}: {
  item: Sentence
  hideEnglish: boolean
  hideChinese: boolean
  isEditMode: boolean
  onUpdateSentence?: (id: string, updates: Partial<Pick<Sentence, 'grammar' | 'meaning'>>) => void
  dragHandle?: React.ReactNode
  canSpeak: boolean
  speaking: boolean
  onSpeak: () => void
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

  /** 同生词卡：离开编辑模式时兜底保存，不指望失焦事件一定来得及 */
  const saveRef = useRef(handleSave)
  saveRef.current = handleSave
  useEffect(() => {
    if (!isEditMode) return
    return () => saveRef.current()
  }, [isEditMode])

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
          <p className="flex-1">
            {/* 角标放在按钮**里面** —— 放外面的话，句子一换行按钮就占满整行宽，
                角标没位置只好掉到下一行独占一行。缘由见 AutoMark 的注释 */}
            <SpeakButton
              canSpeak={canSpeak}
              speaking={speaking}
              onSpeak={onSpeak}
              label="朗读这句"
              className="font-lyric-en font-serif text-base leading-snug text-left"
            >
              {item.text}
              {item.auto && <AutoMark />}
            </SpeakButton>
            {/* 正文改过、这条跟着变了。遮着答案时不显示，否则等于剧透 */}
            {item.sourceText && !item.orphaned && (
              <span className="mt-1 flex flex-wrap items-center gap-1.5">
                <EditedMark sourceText={item.sourceText} expanded={revealed || !hideEnglish} />
              </span>
            )}
          </p>
        ) : (
          <span className="text-ink-muted/70 text-sm">
            点击显示英文
          </span>
        )}
      </div>
      {isEditMode ? (
        <>
          {/* 类名对齐下面阅读态的那两行，切换模式时字不会挪位 */}
          <AutoTextarea
            className="field-inline mt-1 text-sm text-stone-500 font-sans"
            placeholder="句型 / 语法"
            aria-label="句型语法"
            value={localGrammar}
            onChange={setLocalGrammar}
            onBlur={handleSave}
          />
          <div className="mt-2 pt-2 border-t border-stone-100 min-h-[32px]">
            <AutoTextarea
              className="field-inline text-sm text-ink-muted leading-snug"
              placeholder="翻译 / 释义"
              aria-label="翻译"
              value={localMeaning}
              onChange={setLocalMeaning}
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
