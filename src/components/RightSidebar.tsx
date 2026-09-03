import { memo, useState, useEffect } from 'react'
import { useSpeak } from '../hooks/useSpeak'
import { SpeechNotice } from './SpeechNotice'
import { usePrefetchAudio } from '../hooks/usePrefetchAudio'
import { BookOpen, ChevronRight, Trash2, Wand2, Undo2, X } from 'lucide-react'
import type { Sentence } from '../types'
import { AutoMark } from './AutoMark'
import { useIsClamped } from '../hooks/useIsClamped'
import { EditedMark } from './EditedMark'
import { BAND_TOP, BAND_SUB } from './chrome'

interface VocabItem {
  word: string
  anchorId: string
  pageId: string
  phonetic?: string
  pos?: string
  definition?: string
  /** 原文已删除：正文里已经没有这个词了，但笔记被保留下来 */
  orphaned?: boolean
  /** 由 AI 自动填充，需要复核 */
  auto?: boolean
  /** 是短语不是单词。短语没有音标/词性，给一枚小标签认领身份 */
  isPhrase?: boolean
}

type NotesTab = 'vocab' | 'sentences'

interface SentenceCardProps {
  sentence: Sentence
  /** 是否使用交替背景色（对齐生词卡的层次感） */
  alt?: boolean
  /** 当前卡片是否处于激活/展开状态（由父级控制，保证同一时间只有一个） */
  isActive: boolean
  onToggle: () => void
  onJump: (sentence: Sentence) => void
  onDelete: (id: string) => void
}

function SentenceCard({
  sentence,
  alt,
  isActive,
  onToggle,
  onJump,
  onDelete
}: SentenceCardProps) {
  /*
   * 「能不能展开」要看内容是不是真被截断了。
   * 从前不看：三行以内的短句子点一下也进展开态，而展开态的下内边距
   * 比平时多 4px —— 于是点了个寂寞，还凭空多出一截空白。
   * 现在装得下就根本不给点，内边距也不再随展开变化。
   */
  const text = useIsClamped<HTMLParagraphElement>(!isActive, sentence.text)
  const meaning = useIsClamped<HTMLParagraphElement>(!isActive, sentence.meaning)
  const canExpand = isActive || text.clamped || meaning.clamped

  return (
    <div className="flex w-full rounded-lg overflow-hidden">
      {/* 内容区域 */}
      <div
        className={`
          flex-1
          px-2.5 pt-2 pb-2
          flex flex-col gap-2
          ${alt ? 'bg-gray-50' : 'bg-white'}
          ${isActive ? 'bg-stone-50' : ''}
          ${canExpand ? 'cursor-pointer hover:shadow-sm hover:bg-stone-50' : ''}
        `}
        onClick={canExpand ? onToggle : undefined}
      >
        {/* 英文句子：主引用文本 */}
        <p
          ref={text.ref}
          className={`font-serif text-sm text-ink leading-snug ${
            isActive ? '' : 'line-clamp-3'
          }`}
        >
          {sentence.text}
          {sentence.auto && <AutoMark />}
        </p>

        {sentence.orphaned && (
          <div className="flex items-center gap-1.5">
            <span
              className="px-2 py-0.5 rounded-full bg-stone-100 text-ink-muted text-xs font-medium border border-stone-300/70"
              title="正文里已经没有这句话了，笔记被保留下来"
            >
              原文已删除
            </span>
            {/* 同生词卡：孤儿在正文里已无对应内容，只能从这里删 */}
            <button
              type="button"
              onClick={(e) => {
                e.stopPropagation()
                onDelete(sentence.id)
              }}
              className="p-1 rounded-md text-ink-muted hover:bg-red-50 hover:text-red-600"
              title="删除这条句摘"
              aria-label="删除这条句摘"
            >
              <Trash2 className="w-3.5 h-3.5" />
            </button>
          </div>
        )}

        {/* 正文改过、这条跟着变短或错位了。孤儿那枚已经把话说全了，就不再叠一个 */}
        {sentence.sourceText && !sentence.orphaned && (
          <div className="flex flex-wrap items-center gap-1.5">
            <EditedMark sourceText={sentence.sourceText} expanded={isActive} />
          </div>
        )}

        {/* 中文释义：辅助说明 */}
        {sentence.meaning && (
          <p
            ref={meaning.ref}
            className={`text-xs text-stone-500 leading-snug font-sans ${
              isActive ? '' : 'line-clamp-1'
            }`}
          >
            {sentence.meaning}
          </p>
        )}
      </div>

      {/*
        右侧那条窄箭头：跳到这句话在正文里的位置。

        从前它是「编辑」—— 跳过去、收起面板、再弹出底部抽屉改语法和翻译。
        现在只跳，面板留着，抽屉也不弹，和生词卡点词那边一个规矩：
        **生词板是一张清单，点条目是去看它在哪，不是去改它。**
        改语法和翻译在复习页的句摘卡里（编辑模式），那边两格都能改。
      */}
      <button
        type="button"
        onClick={(e) => {
          e.stopPropagation()
          onJump(sentence)
        }}
        title={`跳到这句话在文中的位置`}
        aria-label="跳到这句话在文中的位置"
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
  onScrollToWord: (pageId: string, anchorId: string) => void
  onScrollToSentence: (sentence: Sentence) => void
  /** 删除一条单词笔记。目前只给「原文已删除」的条目用 —— 正常单词在正文里长按即可删，
   *  而孤儿在正文里已经没有对应的词，不给入口就永远删不掉。 */
  onDeleteVocab: (pageId: string, anchorId: string) => void
  /** 删除一条句摘，同上 */
  onDeleteSentence: (id: string) => void
  currentPageId: string | null
  /** 一键划词。不给就不显示那个按钮 */
  onAutoMark?: () => void
  /** 划词弹窗是否开着：开着时这颗按钮一直保持「按下」的样子 */
  autoMarkOpen?: boolean
  /** 刚划完那一批的战报；null 表示没有可显示的 */
  markOutcome?: { marked: number; missed: number; createdIds: string[] } | null
  onUndoMark?: (ids: string[]) => void
  onDismissMark?: () => void
  /** 当前文档阅读进度 0–100 */
  documentProgress?: number
  /** 当前文档在同组内的索引（0-based） */
  currentDocIndex?: number
  /** 同组内文档总数 */
  totalDocsInFolder?: number
  className?: string
  /** 有多宽（像素）。宽屏可拖着改，不给就是 260 —— 见 App.tsx 那根拖杆 */
  width?: number
}

interface VocabCardProps {
  item: VocabItem
  /** 交替底色 */
  alt: boolean
  isActive: boolean
  onToggle: () => void
  onScrollToWord: (pageId: string, anchorId: string) => void
  onDeleteVocab: (pageId: string, anchorId: string) => void
  /** 这台手机读不出声就是 false，那就只跳转、不发声 */
  canSpeak: boolean
  /** 正在读的是不是这一条 */
  speaking: boolean
  onSpeak: () => void
}

/**
 * 生词板里的一张卡。
 *
 * 做成和句摘卡一样「点一下展开」：短语一行放不下就省略号，点卡片看全。
 * 和句摘卡同一条规矩 —— **装得下就根本不给点**，免得点了个寂寞还撑高一截。
 */
function VocabCard({
  item,
  alt,
  isActive,
  onToggle,
  onScrollToWord,
  onDeleteVocab,
  canSpeak,
  speaking,
  onSpeak
}: VocabCardProps) {
  // 只有短语才可能放不下；单个词永远是一行，测了也永远是 false
  const phrase = useIsClamped<HTMLButtonElement>(!isActive, item.word)
  const canExpand = !!item.isPhrase && (isActive || phrase.clamped)

  return (
    <div
      className={`w-full text-left rounded-lg border border-stone-200/70 p-2.5 ${
        alt ? 'bg-gray-50/70' : 'bg-white'
      } ${isActive ? 'bg-stone-50' : ''} ${
        canExpand ? 'cursor-pointer hover:shadow-sm hover:bg-stone-50' : ''
      }`}
      onClick={canExpand ? onToggle : undefined}
    >
      {/* 顶部栏：单词 + 音标 | 词性胶囊 */}
      <div className="flex items-center justify-between gap-2 flex-wrap">
        {/*
          短语和「短语」标签留在同一行。
          曾让短语独占一行、把 173px 让到 223px —— 多装三分之一，
          但标签被挤到下一行去，看着别扭。反正一行放不下就是省略号，
          早截一点无所谓，点开就看全了。
        */}
        <div className="flex items-baseline gap-2 min-w-0 flex-1">
          <button
            type="button"
            onClick={(e) => {
              // 点词是「跳到文中 + 读出来」，别连带把卡片展开了
              e.stopPropagation()
              onScrollToWord(item.pageId, item.anchorId)
              if (canSpeak) onSpeak()
            }}
            ref={phrase.ref}
            className={`font-lyric-en font-serif font-bold text-base text-left hover:underline decoration-accent-600 decoration-2 underline-offset-2 rounded focus:outline-none focus-visible:ring-2 focus-visible:ring-accent-400 transition-colors ${
              // 正在读的那个亮起来，和复习页同一套反馈
              speaking ? 'text-accent-500' : 'text-accent-800'
            } ${
              item.isPhrase
                ? // 短语：一行放不下就省略号，点卡片展开看全。
                  // 这里**必须允许收缩**（min-w-0）—— 从前和单词一样写着 shrink-0，
                  // 于是宁可撑破卡片也不截断，长短语整条溢出到侧栏外面。
                  `min-w-0 break-words ${isActive ? '' : 'line-clamp-1'}`
                : // 单个词不收缩，免得旁边的音标把它挤扁。词短，挤得下
                  'shrink-0'
            }`}
            title={
              canSpeak
                ? `读出「${item.word}」并跳到它在文中的位置`
                : `跳到「${item.word}」在文中的位置`
            }
          >
            {item.word}
            {item.auto && <AutoMark />}
          </button>
          {item.phonetic && (
            <span className="text-xs text-ink-muted italic font-mono truncate">
              {item.phonetic}
            </span>
          )}
        </div>
        {item.orphaned && (
          <span
            className="shrink-0 px-2 py-0.5 rounded-full bg-stone-100 text-ink-muted text-xs font-medium border border-stone-300/70"
            title="正文里已经没有这个词了，笔记被保留下来"
          >
            原文已删除
          </span>
        )}
        {item.isPhrase && (
          <span className="shrink-0 px-2 py-0.5 rounded-full bg-accent-100 text-accent-800 text-xs font-medium">
            短语
          </span>
        )}
        {item.pos && (
          <span className="shrink-0 px-2 py-0.5 rounded-full bg-stone-200/80 text-ink text-xs font-medium">
            {item.pos}
          </span>
        )}
        {/* 只有孤儿才给删除按钮：正常单词回正文里长按就能删，
            而孤儿在正文里已经没有对应的词，不给这个入口就永远删不掉 */}
        {item.orphaned && (
          <button
            type="button"
            onClick={(e) => {
              e.stopPropagation()
              onDeleteVocab(item.pageId, item.anchorId)
            }}
            className="shrink-0 p-1 rounded-md text-ink-muted hover:bg-red-50 hover:text-red-600"
            title="删除这条笔记"
            aria-label={`删除 ${item.word} 的笔记`}
          >
            <Trash2 className="w-3.5 h-3.5" />
          </button>
        )}
      </div>
      {/* 底部栏：中文释义 */}
      {item.definition && (
        <p className="text-xs text-ink-muted mt-1 leading-snug font-sans">
          {item.definition}
        </p>
      )}
    </div>
  )
}

function RightSidebarInner({
  vocab,
  sentences,
  onScrollToWord,
  onScrollToSentence,
  onDeleteVocab,
  onDeleteSentence,
  currentPageId,
  onAutoMark,
  autoMarkOpen = false,
  markOutcome = null,
  onUndoMark,
  onDismissMark,
  documentProgress = 0,
  currentDocIndex = 0,
  totalDocsInFolder = 0,
  className = '',
  width
}: RightSidebarProps) {
  const [tab, setTab] = useState<NotesTab>('vocab')
  const filtered = currentPageId ? vocab.filter((v) => v.pageId === currentPageId) : vocab
  const filteredSentences = currentPageId
    ? sentences.filter((s) => s.docId === currentPageId)
    : sentences
  const [activeSentenceId, setActiveSentenceId] = useState<string | null>(null)
  /** 展开中的生词卡。和句摘一样，同一时间只开一张 */
  const [activeVocabKey, setActiveVocabKey] = useState<string | null>(null)

  /**
   * 点词读出来，跟复习页是同一套：同时只读一个，正在读的那个亮起来。
   * 读不出声的手机 canSpeak 就是 false，那就只跳转、不发声。
   */
  const { canSpeak, speakingId, speak, error: speechError, installVoice, dismissError } = useSpeak()

  /**
   * 这一篇的发音先备好，省掉每个词第一次点时等开口的那半秒。
   * 和复习页共用同一个仓库 —— 那边存过的这里直接就有，不会重复联网。
   */
  usePrefetchAudio(
    filtered.map((v) => v.word),
    canSpeak && tab === 'vocab'
  )

  const folderPercent =
    totalDocsInFolder > 0
      ? ((currentDocIndex + documentProgress / 100) / totalDocsInFolder) * 100
      : 0

  // 当切换文档或标签页时，重置当前激活的句子卡，避免高亮“遗留”
  useEffect(() => {
    setActiveSentenceId(null)
    setActiveVocabKey(null)
  }, [currentPageId, tab])

  // 避免未使用的 setter 在严格 TS 配置下报错


  return (
    <aside
      className={`h-full shrink-0 border-l border-paper-border bg-white/80 flex flex-col overflow-hidden safe-area-padding ${className}`}
      /* 宽度由上面给：宽屏可以拖着改（见 App.tsx 那根拖杆），窄屏一律 260 */
      style={{ width: width ?? 260 }}
    >
      {/* 读不出来时说一句。从前这里把 error 整个丢掉了 —— 见 SpeechNotice */}
      <SpeechNotice error={speechError} onInstall={installVoice} onDismiss={dismissError} />
      <div className={BAND_TOP}>
          <span className="text-sm font-medium text-ink-muted flex items-center gap-2">
            <BookOpen className="w-4 h-4 text-accent-700/80" />
            笔记
            <span className="text-xs font-normal text-gray-400">
              ({tab === 'vocab' ? filtered.length : filteredSentences.length})
            </span>
          </span>
          {/*
            这里从前还有一颗关闭键（只在宽屏出现）。删了 ——
            用户在平板横屏上说「必须点右上角那个按钮关闭，很麻烦」。
            宽屏改成**点中间正文区就收起**（见 App.tsx 里 main 的 onClick），
            窄屏照旧点遮罩或按安卓返回键。三条路都不需要这颗键，
            删掉之后「AI 划词」自然靠到最右，标题行也清爽了。
          */}
          <div className="flex items-center gap-0.5">
            {/*
              一键划词：入口放在这儿，因为它做的是「对着这一篇正文挑词」，
              而生词板正是这一篇笔记的所在 —— 划完新词就出现在下面这张清单里。

              **带文字，不能只留图标。** 从前这里是一枚光秃秃的魔杖，
              说明全在 title 里 —— 而 title 是鼠标悬停才出现的东西，
              手机上根本不存在，于是这个按钮在手机上等于一个没人认识的图案。
              （左侧栏底部那五个图标栽的是同一件事，见 后续规划.md 第十九节。）

              写「AI 划词」而不是「划词」：正文里长按取词本来就是在划词，
              光写「划词」分不出这颗按钮特别在哪；「AI」两个字才是它的卖点。
              标题行量过：260px 窄屏上这一行原本空着 130px，放得下。
            */}
            {onAutoMark && (
              <button
                type="button"
                onClick={onAutoMark}
                /*
                  按下去的反馈：`hover:` 这个变体已经被改成「鼠标悬停 **或** 正按着」
                  两条都出（见 tailwind.config.js），所以这一行同时也是按住时的样子。

                  但光靠按住不够 —— 手指一松就退，点完只看见「唰地亮一下又暗回去」，
                  用户说这样不协调。这颗按钮点完会弹窗，所以**弹窗开着期间一直保持
                  按下的样子**，关掉才还原：让人看得出「这颗按钮和眼前这张弹窗是一回事」。
                */
                className={`flex items-center gap-1 px-2 py-[5px] rounded-lg text-sm font-medium transition-colors hover:bg-stone-100 hover:text-accent-700 ${
                  autoMarkOpen ? 'bg-stone-100 text-accent-700' : 'text-ink-muted'
                }`}
                title="一键划词：让 AI 通读全文挑出重点词"
                aria-label="一键划词"
              >
                <Wand2 className="w-3.5 h-3.5 shrink-0" />
                AI 划词
              </button>
            )}
          </div>
      </div>
      {/*
        第二带：和左侧栏的「阅读/复习」、主区的提示条同高（见 chrome.ts）。
        和那边一样拆掉了「盒中盒」—— 从前是带外框和底色的药丸，在 40px 的带里
        上下只剩 2px，是全场最挤的一处。现在两个标签直接把整条带撑满。
      */}
      <div className={BAND_SUB}>
        <div className="flex w-full self-stretch">
          <button
            type="button"
            onClick={() => setTab('vocab')}
            className={`flex flex-1 items-center justify-center border-b-2 text-sm font-medium transition-colors ${
              tab === 'vocab'
                ? 'border-accent-700 text-accent-800'
                : 'border-transparent text-ink-muted hover:text-ink'
            }`}
          >
            生词
          </button>
          <button
            type="button"
            onClick={() => setTab('sentences')}
            className={`flex flex-1 items-center justify-center border-b-2 text-sm font-medium transition-colors ${
              tab === 'sentences'
                ? 'border-accent-700 text-accent-800'
                : 'border-transparent text-ink-muted hover:text-ink'
            }`}
          >
            句摘
          </button>
        </div>
      </div>
      {/*
        刚划完那一批的战报。**如实报数** —— AI 挑了多少、真划上多少是两回事，
        对不上的一律跳过而不是猜到别的词头上，所以差额要摆出来给人看见。
        一次划几十条，没有撤销的话没人敢按这个按钮，所以撤销就摆在同一行。
      */}
      {markOutcome && (
        <div className="shrink-0 flex items-start gap-2 px-3 py-2 bg-accent-50 border-b border-accent-200 text-xs text-accent-900 leading-relaxed">
          <span className="flex-1">
            已划上 {markOutcome.marked} 条
            {markOutcome.missed > 0 && `，${markOutcome.missed} 条没对上原文`}
          </span>
          {markOutcome.createdIds.length > 0 && onUndoMark && (
            <button
              type="button"
              onClick={() => onUndoMark(markOutcome.createdIds)}
              className="shrink-0 px-2 py-0.5 rounded border border-accent-300 hover:bg-accent-100 font-medium inline-flex items-center gap-1"
            >
              <Undo2 className="w-3 h-3" />
              撤销
            </button>
          )}
          {onDismissMark && (
            <button
              type="button"
              onClick={onDismissMark}
              className="shrink-0 p-0.5 rounded hover:bg-accent-100"
              aria-label="收起这条提示"
            >
              <X className="w-3.5 h-3.5" />
            </button>
          )}
        </div>
      )}
      <div className="flex-1 min-h-0 overflow-y-auto scroll-area py-2 px-2">
        {tab === 'vocab' ? (
          filtered.length === 0 ? (
            <p className="px-2 py-6 text-sm text-ink-muted leading-relaxed">
              在文档中长按英文单词并保存笔记，生词会自动出现在这里。点单词可跳转到文中位置。
            </p>
          ) : (
            <ul className="space-y-2">
              {filtered.map((item, index) => (
              <li key={`${item.pageId}-${item.anchorId}`}>
                <VocabCard
                  item={item}
                  alt={index % 2 !== 0}
                  isActive={activeVocabKey === `${item.pageId}-${item.anchorId}`}
                  onToggle={() =>
                    setActiveVocabKey((cur) =>
                      cur === `${item.pageId}-${item.anchorId}`
                        ? null
                        : `${item.pageId}-${item.anchorId}`
                    )
                  }
                  onScrollToWord={onScrollToWord}
                  onDeleteVocab={onDeleteVocab}
                  canSpeak={canSpeak}
                  speaking={speakingId === `${item.pageId}-${item.anchorId}`}
                  onSpeak={() =>
                    speak(`${item.pageId}-${item.anchorId}`, item.word, { lookup: true })
                  }
                />
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
                  onJump={() => onScrollToSentence(s)}
                  onDelete={onDeleteSentence}
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

/**
 * 用 memo 包一层：阅读时每一帧滚动都会更新最外层的阅读进度状态，
 * 不隔离的话整棵树（含上千个单词节点）每帧重渲染一次，这正是滚动卡顿的来源。
 * props 没变就跳过渲染。
 */
export const RightSidebar = memo(RightSidebarInner)
