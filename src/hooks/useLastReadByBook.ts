import { useEffect, useMemo, useState } from 'react'
import { lastReadPageIds, markLastRead, parseLastReadMap, type LastReadMap } from '../lastRead'
import type { LyricPage } from '../types'

/**
 * 存在手机本地，**不进备份文件**。
 *
 * 它是「这台机器上我读到哪」，跟笔记、句摘那些真东西不是一回事：
 * 写进 AppData 就得改数据格式、改导出导入，老备份还要考虑兼容 ——
 * 为一个书签不值当。跟「文库收起/展开」放在同一个地方，性质也一致。
 */
const STORAGE_KEY = 'lyric-vocab-last-read-by-book'

/**
 * 每个文库各自的「上次读到哪一篇」。返回**这一刻该点亮的那几篇**的 id。
 *
 * 规矩和取舍都在 src/lastRead.ts 里，这里只管接上 React 和 localStorage。
 */
export function useLastReadByBook(
  currentPage: LyricPage | null,
  activePages: LyricPage[]
): Set<string> {
  const [map, setMap] = useState<LastReadMap>(() => {
    try {
      return parseLastReadMap(localStorage.getItem(STORAGE_KEY))
    } catch {
      return {}
    }
  })

  /* 打开了哪一篇就记哪一篇。只认 id 和它所在的文库，别的字段变了（改名、编辑正文）不必重记 */
  const pageId = currentPage?.id ?? null
  const bookId = currentPage?.bookId ?? null
  useEffect(() => {
    if (!pageId) return
    setMap((prev) => markLastRead(prev, { id: pageId, bookId }))
  }, [pageId, bookId])

  /* 落盘和改表分开写：更新函数在严格模式下会被调两次，副作用不该塞在里面 */
  useEffect(() => {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(map))
    } catch {
      /* 存不下就算了，下次打开少一个书签而已，不该拦着人读书 */
    }
  }, [map])

  return useMemo(() => lastReadPageIds(map, activePages), [map, activePages])
}
