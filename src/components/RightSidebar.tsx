import { useState, useEffect } from 'react'
import { PanelRightClose, BookOpen, ChevronRight } from 'lucide-react'
import type { Sentence } from '../types'

interface VocabItem {
  word: string
  anchorId: string
  pageId: string
  phonetic?: string
  pos?: string
  definition?: string
}

type NotesTab = 'vocab' | 'sentences'

interface SentenceCardProps {
  sentence: Sentence
  /** 是否使用交替背景色（对齐生词卡的层次感） */
  alt?: boolean
  /** 当前卡片是否处于激活/展开状态（由父级控制，保证同一时间只有一个） */
  isActive: boolean
  onToggle: () => void
  onEdit: (sentence: Sentence) => void
}

function SentenceCard({
  sentence,
  alt,
  isActive,
  onToggle,
  onEdit
}: SentenceCardProps) {
  return (
    <div className="flex w-full rounded-lg overflow-hidden">
      {/* 内容区域 */}
      <div
        className={`
          flex-1 cursor-pointer
          px-2.5 pt-2 ${isActive ? 'pb-3' : 'pb-2'}
          hover:shadow-sm hover:bg-stone-50
          flex flex-col gap-2
          ${alt ? 'bg-gray-50' : 'bg-white'}
          ${isActive ? 'bg-stone-50' : ''}
        `}
        onClick={onToggle}
      >
        {/* 英文句子：主引用文本 */}
        <p
          className={`font-serif text-sm text-ink leading-snug ${
            isActive ? '' : 'line-clamp-3'
          }`}
        >
          {sentence.text}
        </p>

        {/* 中文释义：辅助说明 */}
        {sentence.meaning && (
          <p
            className={`text-xs text-stone-500 leading-snug font-sans ${
              isActive ? '' : 'line-clamp-1'
            }`}
          >
            {sentence.meaning}
          </p>
        )}
      </div>

      {/* 右侧固定编辑按钮 */}
      <button
        type="button"
        onClick={(e) => {
          e.stopPropagation()
          onEdit(sentence)
        }}
        className={`
          w-4 flex items-center justify-center hover:bg-stone-50 rounded-r-lg
          ${alt ? 'bg-gray-50' : 'bg-white'}
          ${isActive ? 'bg-stone-50' : ''}
        `}
      >
        <ChevronRight className="w-3.5 h-3.5 text-gray-300" aria-hidden="true" />
      </button>
    </div>
  )
}

interface RightSidebarProps {
  vocab: VocabItem[]
  sentences: Sentence[]
  setSentences: React.Dispatch<React.SetStateAction<Sentence[]>>
  onScrollToWord: (pageId: string, anchorId: string) => void
  onEditSentence: (sentence: Sentence) => void
  currentPageId: string | null
  onClose: () => void
  /** 当前文档阅读进度 0–100 */
  documentProgress?: number
  /** 当前文档在同组内的索引（0-based） */
  currentDocIndex?: number
  /** 同组内文档总数 */
  totalDocsInFolder?: number
  className?: string
}

export function RightSidebar({
  vocab,
  sentences,
  setSentences: _setSentences,
  onScrollToWord,
  onEditSentence,
  currentPageId,
  onClose,
  documentProgress = 0,
  currentDocIndex = 0,
  totalDocsInFolder = 0,
  className = ''
}: RightSidebarProps) {
  const [tab, setTab] = useState<NotesTab>('vocab')
  const filtered = currentPageId ? vocab.filter((v) => v.pageId === currentPageId) : vocab
  const filteredSentences = currentPageId
    ? sentences.filter((s) => s.docId === currentPageId)
    : sentences
  const [activeSentenceId, setActiveSentenceId] = useState<string | null>(null)

  const folderPercent =
    totalDocsInFolder > 0
      ? ((currentDocIndex + documentProgress / 100) / totalDocsInFolder) * 100
      : 0

  // 当切换文档或标签页时，重置当前激活的句子卡，避免高亮“遗留”
  useEffect(() => {
    setActiveSentenceId(null)
  }, [currentPageId, tab])

  // 避免未使用的 setter 在严格 TS 配置下报错
  void _setSentences


  return (
    <aside
      className={`w-[260px] md:w-[350px] h-full shrink-0 border-l border-paper-border bg-white/80 flex flex-col overflow-hidden safe-area-padding ${className}`}
    >
      <div className="shrink-0 p-3 border-b border-paper-border">
        <div className="flex items-center justify-between mb-2">
          <span className="text-sm font-medium text-ink-muted flex items-center gap-2">
            <BookOpen className="w-4 h-4 text-amber-700/80" />
            笔记
            <span className="text-xs font-normal text-gray-400">
              ({tab === 'vocab' ? filtered.length : filteredSentences.length})
            </span>
          </span>
          <button
            type="button"
            onClick={onClose}
            className="p-1.5 rounded-lg hover:bg-stone-100 text-ink-muted hover:text-ink"
            title="关闭笔记"
          >
            <PanelRightClose className="w-4 h-4" />
          </button>
        </div>
        <div className="flex rounded-lg border border-stone-200/80 p-0.5 bg-stone-50/80">
          <button
            type="button"
            onClick={() => setTab('vocab')}
            className={`flex-1 py-1.5 text-xs font-medium rounded-md transition-colors ${
              tab === 'vocab'
                ? 'bg-white text-amber-800 shadow-sm border border-stone-200/80'
                : 'text-ink-muted hover:text-ink'
            }`}
          >
            生词
          </button>
          <button
            type="button"
            onClick={() => setTab('sentences')}
            className={`flex-1 py-1.5 text-xs font-medium rounded-md transition-colors ${
              tab === 'sentences'
                ? 'bg-white text-amber-800 shadow-sm border border-stone-200/80'
                : 'text-ink-muted hover:text-ink'
            }`}
          >
            句摘
          </button>
        </div>
      </div>
      <div className="flex-1 min-h-0 overflow-y-auto scroll-area py-2 px-2">
        {tab === 'vocab' ? (
          filtered.length === 0 ? (
            <p className="px-2 py-6 text-sm text-ink-muted leading-relaxed">
              在文档中点击英文单词并保存笔记，生词会自动出现在这里。点击卡片可跳转到文中位置。
            </p>
          ) : (
            <ul className="space-y-2">
              {filtered.map((item, index) => (
              <li key={`${item.pageId}-${item.anchorId}`}>
                <button
                  type="button"
                  onClick={() => onScrollToWord(item.pageId, item.anchorId)}
                  className={`w-full text-left rounded-lg border border-stone-200/70 p-2.5 hover:border-stone-300/80 hover:shadow-sm transition-all group ${
                    index % 2 === 0 ? 'bg-white' : 'bg-gray-50/70'
                  }`}
                >
                  {/* 顶部栏：单词 + 音标 | 词性胶囊 */}
                  <div className="flex items-center justify-between gap-2 flex-wrap">
                    <div className="flex items-baseline gap-2 min-w-0 flex-1">
                      <span className="font-lyric-en font-serif text-amber-800 font-bold text-base shrink-0 group-hover:underline">
                        {item.word}
                      </span>
                      {item.phonetic && (
                        <span className="text-xs text-ink-muted italic font-mono truncate">
                          {item.phonetic}
                        </span>
                      )}
                    </div>
                    {item.pos && (
                      <span className="shrink-0 px-2 py-0.5 rounded-full bg-stone-200/80 text-ink text-xs font-medium">
                        {item.pos}
                      </span>
                    )}
                  </div>
                  {/* 底部栏：中文释义 */}
                  {item.definition && (
                    <p className="text-xs text-ink-muted mt-1 leading-snug font-sans">
                      {item.definition}
                    </p>
                  )}
                </button>
              </li>
            ))}
          </ul>
          )
        ) : filteredSentences.length === 0 ? (
          <p className="px-2 py-6 text-sm text-ink-muted leading-relaxed">
            暂无句摘。在后续步骤中可从文中选中句子并保存到这里。
          </p>
        ) : (
          <ul className="space-y-2">
            {filteredSentences.map((s, index) => (
              <li key={s.id}>
                <SentenceCard
                  sentence={s}
                  alt={index % 2 === 1}
                  isActive={activeSentenceId === s.id}
                  onToggle={() =>
                    setActiveSentenceId((prev) => (prev === s.id ? null : s.id))
                  }
                  onEdit={() => {
                    onEditSentence(s)
                  }}
                />
              </li>
            ))}
          </ul>
        )}
      </div>

      <div className="shrink-0 p-2 border-t border-paper-border bg-stone-50/50 flex flex-col gap-1.5">
        <div className="flex items-center gap-2">
          <div className="flex-1 h-1 rounded-full bg-gray-200 overflow-hidden">
            <div
              className="h-full rounded-full bg-gray-500 transition-[width] duration-150"
              style={{ width: `${Math.min(100, Math.max(0, documentProgress))}%` }}
            />
          </div>
          <span className="text-xs text-gray-400 tabular-nums w-8 text-right">
            {Math.round(documentProgress)}%
          </span>
        </div>
        <div className="flex items-center gap-2">
          <div className="flex-1 h-1 rounded-full bg-gray-200 overflow-hidden">
            <div
              className="h-full rounded-full bg-gray-500 transition-[width] duration-150"
              style={{ width: `${Math.min(100, Math.max(0, folderPercent))}%` }}
            />
          </div>
          <span className="text-xs text-gray-400 tabular-nums w-8 text-right">
            {Math.round(folderPercent)}%
          </span>
        </div>
      </div>
    </aside>
  )
}
