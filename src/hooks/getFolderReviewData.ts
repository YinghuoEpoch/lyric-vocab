import type { Annotation, LyricPage } from '../types'
import { isOrphanAnnotation } from '../types'

export interface FolderVocabItem {
  id: string
  pageId: string
  pageTitle: string
  word: string
  phonetic?: string
  pos?: string
  definition?: string
  /** 原文已删除 / 由 AI 填充：文库模式的卡片也要显示这些标记 */
  orphaned?: boolean
  auto?: boolean
  frequency: number
}

/**
 * 文库级复习：把该文库下所有文档的生词按拼写合并，统计出现次数。
 *
 * 注意这里的条目是**合并出来的**，不是某一条标注本身 ——
 * 同一个词在三篇文档里各标过一次，这里只出现一条、频次记 3。
 * 所以文库模式的卡片没法拖拽排序（拖了也没有一条标注可以写回去），
 * 排序只在单篇文档的复习里提供。
 */
export function getFolderReviewData(
  bookId: string,
  pages: LyricPage[],
  annotations: Annotation[]
): { high: FolderVocabItem[]; normal: FolderVocabItem[] } {
  const pagesInBook = pages.filter((p) => p.bookId === bookId && !p.deletedAt)
  const titleOf = new Map(pagesInBook.map((p) => [p.id, p.title || '未命名']))

  const inBook = annotations
    .filter((a) => a.type !== 'sentence' && titleOf.has(a.docId) && a.text)
    .sort((a, b) => a.order - b.order)

  const byWord = new Map<string, FolderVocabItem>()

  for (const a of inBook) {
    const key = a.text.trim().toLowerCase()
    if (!key) continue
    const existing = byWord.get(key)
    if (!existing) {
      byWord.set(key, {
        id: `${a.docId}-${key}`,
        pageId: a.docId,
        pageTitle: titleOf.get(a.docId) ?? '未命名',
        word: a.text,
        phonetic: a.phonetic,
        pos: a.pos,
        definition: a.definition,
        orphaned: isOrphanAnnotation(a) || undefined,
        auto: a.auto,
        frequency: 1
      })
    } else {
      existing.frequency += 1
      // 保留第一次出现的定义/音标/词性即可，后续冲突忽略
    }
  }

  const all = Array.from(byWord.values())
  const high = all
    .filter((i) => i.frequency > 1)
    .sort((a, b) => {
      if (b.frequency !== a.frequency) return b.frequency - a.frequency
      return a.word.localeCompare(b.word)
    })

  const normal = all
    .filter((i) => i.frequency === 1)
    .sort((a, b) => a.word.localeCompare(b.word))

  return { high, normal }
}
