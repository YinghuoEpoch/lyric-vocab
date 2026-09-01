import { cacheKey, cachedKeySet, putCached } from './audioCache'
import { AMERICAN, dictFetchUrl, isLookupWorthy, normalizeWord } from './dictAudio'
import { fetchAudioBytes } from './fetchAudio'

/**
 * 打开复习页时，把这一页的词悄悄取回来存好。
 *
 * 为什么值得：不预取的话，每个词**第一次**点都要等那半秒（联网取录音）。
 * 一页二三十个词一共约 300KB，取一次就再也不用取了 —— 之后点哪个都是秒响，
 * 没网也照样能读。
 *
 * 三条规矩：
 * - **已经存过的直接跳过**，不重复联网
 * - **一个一个来**，不一次甩几十个请求出去把网占满 —— 反正是背地里干的，不急
 * - **失败了不吭声**。预取是锦上添花，取不到大不了点的时候现取、再不行退回机器音
 * - **有上限**。单篇一页也就二三十个词，可「文库复习」是把所有文档并在一起的，
 *   动辄上千 —— 一开就闷头下几十兆不像话。取前面一批，剩下的点到了现取
 */
export const PREFETCH_LIMIT = 200

export async function prefetchWords(
  words: readonly string[],
  options: { type?: number; stopped?: () => boolean; limit?: number } = {}
): Promise<{ 取了: number; 跳过: number; 失败: number }> {
  const type = options.type ?? AMERICAN
  const stopped = options.stopped ?? (() => false)
  const have = await cachedKeySet()
  const stat = { 取了: 0, 跳过: 0, 失败: 0 }

  // 同一页里同一个词可能标过好几次，去重
  const todo = [...new Set(words.map(normalizeWord).filter(isLookupWorthy))].slice(
    0,
    options.limit ?? PREFETCH_LIMIT
  )

  for (const word of todo) {
    if (stopped()) break
    if (have.has(cacheKey(word, type))) {
      stat.跳过++
      continue
    }
    try {
      const bytes = await fetchAudioBytes(dictFetchUrl(word, type))
      if (stopped()) break
      await putCached(cacheKey(word, type), bytes)
      stat.取了++
    } catch {
      stat.失败++
    }
  }
  return stat
}
