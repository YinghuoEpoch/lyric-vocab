import { Capacitor } from '@capacitor/core'
import { cacheKey, getCached, isCached, putCached } from './audioCache'
import { fetchAudioBytes, NoRecording } from './fetchAudio'
import { stripEdgePunctuation } from '../utils/punctuation'
import type { DictPlayer } from './types'

/**
 * 词典的真人发音。
 *
 * 系统朗读的嗓子好不好，取决于这台手机装了什么引擎 —— 厂商自带的引擎中文做得好，
 * 英文往往只塞一个凑合的嗓子，而且换不掉。所以单词和短语不走合成，
 * 直接取词典里**人录好的** mp3 放出来。
 *
 * **词典只收词条，整句没有** —— 所以句摘卡不走这条路，由调用处决定（见 humanFirst.ts）。
 * 取不到就抛错，让上层退回系统朗读；这里不做兜底，兜底是外面那层壳的事。
 *
 * 取回来的录音会**存下来**（audioCache.ts）：第二次点同一个词不再联网，
 * 也没有等开口的那半秒，飞行模式下照样能读。
 */

const BASE = 'https://dict.youdao.com/dictvoice'

/** 1 是英音，2 是美音 */
export const BRITISH = 1
export const AMERICAN = 2

/**
 * 开口的等待上限。
 *
 * 网络不给力时不能让人一直干等着 —— 到点就当没有这个录音，退回系统朗读，
 * 至少立刻有声音。一旦开始播就把这个限制撤掉，后面播多久是录音长度说了算。
 */
export const START_TIMEOUT_MS = 2500

/**
 * 这段文字值不值得去查真人录音。
 *
 * 单词、短语都查得到，整句查不到。这里只挡明显不可能的（空的、长得离谱的），
 * 真正「这是词还是句」的判断在调用处 —— 那边知道点的是哪种卡片，不用猜。
 */
export function isLookupWorthy(text: string): boolean {
  const t = text.trim()
  if (!t) return false
  // 词典最长的固定搭配也就几个词；再长必是句子，白跑一趟
  return t.split(/\s+/).length <= 5
}

/**
 * 查词典之前先把词规整一下。
 *
 * **弯撇号必须换成直的。** 词典只认直撇号：`don't` 有录音，`don’t` 直接告诉你没有 ——
 * 差别仅仅是那一个字符。而导入的电子书里基本全是弯的，不换的话
 * `don't` `it's` `can't` `I'd` 这一整类**本来有真人录音的词会白白落回机器音**。
 *
 * 这个项目别处早就在统一两种撇号了（分词、对账、划词都特意处理过），
 * 是查词典这段漏了。
 */
export function normalizeWord(word: string): string {
  // 两头的标点也去掉：`he said.` 词典是查不到的。新存的短语已经不带标点了，
  // 这里是给旧数据兜底 —— 存进去的时候还没有这道剥离
  return stripEdgePunctuation(word.trim()).replace(/[’ʼ՚]/g, "'")
}

/** 播放用的地址：audio 标签放外站的声音不受跨域限制，一直用真地址 */
export function dictAudioUrl(word: string, type: number = AMERICAN): string {
  return `${BASE}?audio=${encodeURIComponent(normalizeWord(word))}&type=${type}`
}

/**
 * 取字节用的地址。
 *
 * 手机上和播放同一个真地址（走原生网络，没有跨域这回事）；
 * 电脑浏览器里换成 vite 的开发转发，否则 fetch 会被跨域拦掉、缓存这段就没法验。
 */
export function dictFetchUrl(word: string, type: number = AMERICAN): string {
  if (Capacitor.isNativePlatform()) return dictAudioUrl(word, type)
  return `/dictvoice?audio=${encodeURIComponent(normalizeWord(word))}&type=${type}`
}

/**
 * 把一个词的录音取回来存好，不播。
 *
 * 打开复习页时拿它把整页悄悄备着 —— 已经存过的直接跳过，不重复联网。
 * 取不到就算了：预取是锦上添花，失败不该惊动任何人。
 */
export async function prefetchWord(word: string, type: number = AMERICAN): Promise<boolean> {
  const key = cacheKey(normalizeWord(word), type)
  if (await isCached(key)) return true
  try {
    const bytes = await fetchAudioBytes(dictFetchUrl(word, type))
    await putCached(key, bytes)
    return true
  } catch {
    return false
  }
}

export function createDictPlayer(type: number = AMERICAN): DictPlayer {
  /** 当前这次播放的收尾函数；换一个词或者被叫停时用它把上一次结束掉 */
  let finishCurrent: ((cancelled: boolean) => void) | null = null
  /**
   * 每次 play 发一个号。
   *
   * 取录音是要等的（查缓存、联网），这中间用户完全可能已经点了别的词或者按了停。
   * 等回来以后不对一下号就直接播，放出来的就是**上一个词** —— 而且会跟新的那个撞在一起。
   */
  let generation = 0

  /** 把一个地址（或存下来的录音）放出来；放完、被叫停、放不出来都会结束 */
  function playSrc(src: string, revoke: boolean): Promise<void> {
    const audio = new Audio(src)
    audio.preload = 'auto'

    return new Promise<void>((resolve, reject) => {
      let timer: number | undefined

      const settle = (cancelled: boolean, error?: Error) => {
        if (finishCurrent !== finish) return
        finishCurrent = null
        if (timer !== undefined) clearTimeout(timer)
        audio.onerror = audio.onended = audio.onplaying = null
        audio.pause()
        if (revoke) URL.revokeObjectURL(src)
        // 被叫停算正常结束，不能当成「没有录音」—— 否则上层会接着用系统朗读
        // 把用户刚按停的词再念一遍
        if (cancelled || !error) resolve()
        else reject(error)
      }
      const finish = settle
      finishCurrent = finish

      audio.onerror = () => settle(false, new NoRecording('没有这个词的真人录音'))
      audio.onended = () => settle(false)
      // 开始出声了，等待上限就该撤掉
      audio.onplaying = () => {
        if (timer !== undefined) {
          clearTimeout(timer)
          timer = undefined
        }
      }
      timer = setTimeout(
        () => settle(false, new Error('取录音太慢了')),
        START_TIMEOUT_MS
      ) as unknown as number

      audio.play().catch(() => settle(false, new Error('放不出来')))
    })
  }

  return {
    async play(word) {
      const mine = ++generation
      finishCurrent?.(true)
      const key = cacheKey(normalizeWord(word), type)
      /** 等回来发现已经被顶掉了：当作正常结束，别播、也别让上层退回系统朗读 */
      const superseded = () => generation !== mine

      // 1. 存过就直接放，不联网、没有等开口那半秒
      const cached = await getCached(key)
      if (superseded()) return
      if (cached) return playSrc(URL.createObjectURL(cached), true)

      // 2. 没存过：取回来、存下、再放。一次网络请求做两件事
      try {
        const bytes = await fetchAudioBytes(dictFetchUrl(word, type))
        await putCached(key, bytes)
        if (superseded()) return
        return await playSrc(URL.createObjectURL(new Blob([bytes], { type: 'audio/mpeg' })), true)
      } catch (e) {
        if (superseded()) return
        // 词典里确实没有这个词条 —— 别再试了，交给上层退回系统朗读
        if (e instanceof NoRecording) throw e
      }

      // 3. 取字节这条路不通（跨域没转发、原生网络出岔子），
      //    还有直接流着播这条老路 —— 放得出来就先让用户听见，只是这次存不下来
      return playSrc(dictAudioUrl(word, type), false)
    },

    cancel() {
      // 号也往前走一格：正在等录音的那次，等回来必须发现自己已经作废
      generation++
      finishCurrent?.(true)
    }
  }
}
