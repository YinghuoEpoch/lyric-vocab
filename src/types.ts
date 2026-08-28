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
}
