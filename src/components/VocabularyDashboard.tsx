import { useEffect, useState } from 'react'
import { BookOpen, FileText, Eye, EyeOff } from 'lucide-react'
import type { LyricPage, NotesMap, Sentence, WordNote } from '../types'
import { getFolderReviewData } from '../hooks/getFolderReviewData'
import { useIsMobile } from '../hooks/useIsMobile'

export type ReviewTarget =
  | { type: 'page'; id: string }
  | { type: 'book'; id: string }
  | null

interface VocabCardItem {
  pageId: string
  pageTitle: string
  anchorId: string
  word: string
  phonetic?: string
  pos?: string
  definition?: string
   // 仅用于文件夹复习模式下的词频统计
  frequency?: number
}

export interface VocabularyDashboardProps {
  reviewTarget: ReviewTarget
  books: { id: string; name: string }[]
  pages: LyricPage[]
  notes: Record<string, NotesMap>
  /** 句摘列表，用于复习模式下的「句」模式 */
  sentences?: Sentence[]
  isEditMode: boolean
  onUpdateWord: (word: string, updates: Partial<WordNote>) => void
  /** 复习模式下编辑句摘（句型/翻译） */
  onUpdateSentence?: (id: string, updates: Partial<Pick<Sentence, 'grammar' | 'meaning'>>) => void
  onVocabCountChange?: (count: number) => void
  [key: string]: any
}

export function VocabularyDashboard({
  reviewTarget,
  pages,
  notes,
  sentences = [],
  isEditMode,
  onUpdateWord,
  onUpdateSentence,
  onVocabCountChange
}: VocabularyDashboardProps) {
  const [hideEnglish, setHideEnglish] = useState(false)
  const [hideChinese, setHideChinese] = useState(false)
  const [reviewMode, setReviewMode] = useState<'vocab' | 'sentence'>('vocab')

  const getPageTitle = (pageId: string) =>
    pages.find((p) => p.id === pageId)?.title || '未命名'

  const getVocabByPage = (pageId: string): VocabCardItem[] => {
    const map = notes[pageId]
    if (!map) return []
    const pageTitle = getPageTitle(pageId)
    return Object.entries(map)
      .filter(([, n]) => n?.word)
      .map(([anchorId, n]) => ({
        pageId,
        pageTitle,
        anchorId,
        word: n!.word,
        phonetic: n!.phonetic,
        pos: n!.pos,
        definition: n!.definition
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
    const { high, normal } = getFolderReviewData(reviewTarget.id, pages, notes)

    const sections: { title: string; pageId: string; items: VocabCardItem[] }[] = []

    if (high.length > 0) {
      sections.push({
        title: '高频 / 重点生词',
        pageId: `${reviewTarget.id}-high`,
        items: high.map((i) => ({
          pageId: i.pageId,
          pageTitle: i.pageTitle,
          anchorId: i.id,
          word: i.word,
          phonetic: i.phonetic,
          pos: i.pos,
          definition: i.definition,
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
          anchorId: i.id,
          word: i.word,
          phonetic: i.phonetic,
          pos: i.pos,
          definition: i.definition,
          frequency: i.frequency
        }))
      })
    }

    return sections
  }

  type SentenceSection = { title: string; pageId: string; items: Sentence[] }

  const getGroupedSentences = (): SentenceSection[] => {
    if (!reviewTarget || !sentences.length) return []
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
          <button
            type="button"
            onClick={() => setHideEnglish((v) => !v)}
            className={`flex items-center gap-2 px-3 py-1.5 rounded-lg text-sm font-medium transition-colors ${
              hideEnglish ? 'bg-amber-100 text-amber-800' : 'bg-stone-100 text-ink-muted hover:bg-stone-200'
            }`}
          >
            {hideEnglish ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
            隐藏英文
          </button>
          <button
            type="button"
            onClick={() => setHideChinese((v) => !v)}
            className={`flex items-center gap-2 px-3 py-1.5 rounded-lg text-sm font-medium transition-colors ${
              hideChinese ? 'bg-amber-100 text-amber-800' : 'bg-stone-100 text-ink-muted hover:bg-stone-200'
            }`}
          >
            {hideChinese ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
            隐藏中文
          </button>
        </div>
        <button
          type="button"
          onClick={() => setReviewMode((v) => (v === 'vocab' ? 'sentence' : 'vocab'))}
          className="px-3 py-1.5 rounded-lg text-sm font-medium text-ink-muted hover:bg-stone-100 focus:bg-stone-100 focus:outline-none transition-colors"
        >
          {reviewMode === 'vocab' ? '词' : '句'}
        </button>
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
                <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4">
                  {group.items.map((item) => (
                    <VocabCard
                      key={item.anchorId}
                      item={item}
                      hideEnglish={hideEnglish}
                      hideChinese={hideChinese}
                      isEditMode={isEditMode}
                      onUpdateWord={onUpdateWord}
                    />
                  ))}
                </div>
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
                <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4">
                  {group.items.map((item) => (
                    <SentenceCard
                      key={item.id}
                      item={item}
                      hideEnglish={hideEnglish}
                      hideChinese={hideChinese}
                      isEditMode={isEditMode}
                      onUpdateSentence={onUpdateSentence}
                    />
                  ))}
                </div>
              </section>
            ))}
          </div>
        )}
      </div>
    </div>
  )
}

function VocabCard({
  item,
  hideEnglish,
  hideChinese,
  isEditMode,
  onUpdateWord
}: {
  item: VocabCardItem
  hideEnglish: boolean
  hideChinese: boolean
  isEditMode: boolean
  onUpdateWord: (word: string, updates: Partial<WordNote>) => void
}) {
  const [hover, setHover] = useState(false)
  const isMobile = useIsMobile()
  const showEnglish = !hideEnglish || hover
  const showChinese = !hideChinese || hover
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
      className="rounded-xl border border-stone-200 bg-white p-4 shadow-sm hover:shadow-md hover:border-amber-200/60 transition-all min-h-[100px]"
      onMouseEnter={() => setHover(true)}
      onMouseLeave={() => setHover(false)}
    >
      <div className="flex items-start justify-between gap-2 flex-wrap">
        <div className="min-w-0 flex-1 min-h-[28px]">
          {showEnglish ? (
            <span className="font-lyric-en font-serif text-amber-800 font-bold text-lg block">
              {item.word}
            </span>
          ) : (
            <span className="text-ink-muted/70 text-sm">
              {isMobile ? '点击显示英文' : '悬停显示英文'}
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
              {isMobile ? '点击显示释义' : '悬停显示释义'}
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
  onUpdateSentence
}: {
  item: Sentence
  hideEnglish: boolean
  hideChinese: boolean
  isEditMode: boolean
  onUpdateSentence?: (id: string, updates: Partial<Pick<Sentence, 'grammar' | 'meaning'>>) => void
}) {
  const [hover, setHover] = useState(false)
  const isMobile = useIsMobile()
  const showEnglish = !hideEnglish || hover
  const showChinese = !hideChinese || hover
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
      className="rounded-xl border border-stone-200 bg-white p-4 shadow-sm hover:shadow-md hover:border-amber-200/60 transition-all min-h-[100px]"
      onMouseEnter={() => setHover(true)}
      onMouseLeave={() => setHover(false)}
    >
      <div className="min-h-[28px]">
        {showEnglish ? (
          <p className="font-lyric-en font-serif text-amber-800 text-base leading-snug">
            {item.text}
          </p>
        ) : (
          <span className="text-ink-muted/70 text-sm">
            {isMobile ? '点击显示英文' : '悬停显示英文'}
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
                  {isMobile ? '点击显示翻译' : '悬停显示翻译'}
                </span>
              )}
            </div>
          )}
        </>
      )}
    </div>
  )
}
