export interface LyricBook {
  id: string
  name: string
  createdAt: number
  deletedAt?: number
}

export interface LyricPage {
  id: string
  /**
   * 所属文库 ID；为 null 时表示顶层「根」文档（不在任何文库中）。
   */
  bookId: string | null
  title: string
  content: string
  updatedAt: number
  deletedAt?: number
  /** 阅读进度：滚动位置 scrollTop，用于恢复上次阅读位置 */
  progress?: number
}

export interface WordNote {
  word: string
  phonetic?: string
  pos?: string
  definition?: string
  /**
   * 由 AI 自动填充。用于在界面上标出「这条是机器填的、需要复核」，
   * 也便于一键撤销全部自动填充的内容。用户手动改过之后应清掉此标记。
   */
  auto?: boolean
  /** 词的原形（stood -> stand）。目前不显示，留给以后接词典用。 */
  lemma?: string
  /**
   * 原文已删除：正文编辑后找不到这个词了，但用户选择了保留笔记。
   * 界面上会标出来，方便一眼认出「这条笔记在文中已经没有对应内容了」。
   * 若之后原文里又出现这个词，对账时会自动重新挂上并清掉此标记。
   */
  orphaned?: boolean
}

export type NotesMap = Record<string, WordNote> // anchorId -> WordNote

export interface AppData {
  books: LyricBook[]
  pages: LyricPage[]
  notes: Record<string, NotesMap> // pageId -> NotesMap
  /** 句摘备份：按数组整体存到备份 JSON 中；运行期仍主要使用 localStorage 中的 SENTENCES_KEY */
  sentences?: Sentence[]
}

export type ReaderSettings = {
  fontSize: number
  fontFamily: 'sans' | 'serif' | 'rounded'
  /** 仅浅色变体：纯白 / 青灰(Sage) / 暖白 */
  theme: 'pure' | 'original' | 'rice'
}

/** 句摘：用户保存的句子（范围文本），用于句型/翻译笔记 */
export interface Sentence {
  id: string
  /** 完整句子原文 */
  text: string
  /** 句型/语法说明 */
  grammar: string
  /** 翻译或释义 */
  meaning: string
  /** 所属文档 ID */
  docId: string
  /** 句子起始单词的 anchorId（用于在原文中持久标记范围） */
  startAnchorId: string
  /** 句子结束单词的 anchorId（用于在原文中持久标记范围） */
  endAnchorId: string
  /** 创建/更新时间戳 */
  date: number
  /** 原文已删除；含义同 WordNote.orphaned */
  orphaned?: boolean
  /** 由 AI 自动填充；含义同 WordNote.auto */
  auto?: boolean
}
