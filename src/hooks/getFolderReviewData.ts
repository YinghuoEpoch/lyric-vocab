import type { LyricPage, NotesMap } from '../types'

export interface FolderVocabItem {
  id: string
  pageId: string
  pageTitle: string
  word: string
  phonetic?: string
  pos?: string
  definition?: string
  frequency: number
}

export function getFolderReviewData(
  bookId: string,
  pages: LyricPage[],
  notes: Record<string, NotesMap>
): { high: FolderVocabItem[]; normal: FolderVocabItem[] } {
  const pagesInBook = pages.filter((p) => p.bookId === bookId && !p.deletedAt)

  const byWord = new Map<string, FolderVocabItem>()

  for (const page of pagesInBook) {
    const map = notes[page.id]
    if (!map) continue
    const pageTitle = page.title || '未命名'

    for (const n of Object.values(map)) {
      if (!n?.word) continue
      const key = n.word.trim().toLowerCase()
      const existing = byWord.get(key)
      if (!existing) {
        byWord.set(key, {
          id: `${page.id}-${key}`,
          pageId: page.id,
          pageTitle,
          word: n.word,
          phonetic: n.phonetic,
          pos: n.pos,
          definition: n.definition,
          frequency: 1
        })
      } else {
        existing.frequency += 1
        // 保留第一次出现的定义/音标/词性即可，后续冲突忽略
      }
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

