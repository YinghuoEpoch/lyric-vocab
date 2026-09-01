import localforage from 'localforage'

/**
 * 存发音录音的地方。
 *
 * **单开一个库，绝不能塞进主数据里。** 这个 App 是把全部笔记当一整块存的，
 * 每改一条就整块重写一遍 —— 录音混进去，以后每存一条笔记都要驮着几十兆音频走，
 * 导出的备份文件也会被撑爆。录音是「丢了还能再下」的东西，跟正文数据不是一回事。
 */

const store = localforage.createInstance({
  name: 'lyric-vocab',
  storeName: 'dict_audio',
  description: '词典发音录音'
})

/**
 * 一份「存了哪些、各多大」的小账。
 *
 * 不这么记的话，想知道「占了多少」就得把所有录音读出来量一遍 ——
 * 设置页每开一次卡一下，没必要。账本自己很小，跟录音存在同一个库里。
 */
const INDEX_KEY = '__index'

type Index = Record<string, number>

/** 同一个词的英音和美音是两份，键里带上 */
export function cacheKey(word: string, type: number): string {
  return `${word.trim().toLowerCase()}|${type}`
}

async function readIndex(): Promise<Index> {
  return (await store.getItem<Index>(INDEX_KEY)) ?? {}
}

export async function getCached(key: string): Promise<Blob | null> {
  const bytes = await store.getItem<ArrayBuffer>(key)
  return bytes ? new Blob([bytes], { type: 'audio/mpeg' }) : null
}

export async function putCached(key: string, bytes: ArrayBuffer): Promise<void> {
  await store.setItem(key, bytes)
  const index = await readIndex()
  index[key] = bytes.byteLength
  await store.setItem(INDEX_KEY, index)
}

export async function isCached(key: string): Promise<boolean> {
  const index = await readIndex()
  return key in index
}

/**
 * 一次把「已经存了哪些」全拿出来。
 *
 * 预取要对一整页的词挨个问「存过没有」，一个个问就是一页几十次读取；
 * 账本读一次就够了。
 */
export async function cachedKeySet(): Promise<Set<string>> {
  return new Set(Object.keys(await readIndex()))
}

export interface CacheStats {
  count: number
  bytes: number
}

export async function cacheStats(): Promise<CacheStats> {
  const index = await readIndex()
  const sizes = Object.values(index)
  return { count: sizes.length, bytes: sizes.reduce((a, b) => a + b, 0) }
}

export async function clearCache(): Promise<void> {
  await store.clear()
}

/** 「6.1MB」这种给人看的写法 */
export function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes}B`
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)}KB`
  return `${(bytes / (1024 * 1024)).toFixed(1)}MB`
}
