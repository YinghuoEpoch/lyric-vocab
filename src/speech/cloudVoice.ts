import { cacheKey, getCached, putCached } from './audioCache'
import {
  CloudNotConfigured,
  isCloudReady,
  loadCloudConfig,
  newReqId,
  synthesizeCloud,
  type CloudTtsConfig
} from './cloudTts'
import type { DictPlayer } from './types'

/**
 * 云端合成的「放一段音」。
 *
 * 用 DictPlayer 那个约定（play / cancel），因为它做的事一模一样：
 * **拿到一段现成的音频放出来，拿不到就抛错让上层往下走。**
 * 差别只在音频从哪儿来 —— 那边是词典里人录的，这边是云端合成的。
 *
 * ## 存下来，同一句永远只花一次调用次数
 *
 * 和真人录音共用同一个仓库（audioCache），只是键不一样：
 * **键里带音色**，否则换了音色还会放出旧音色的那一份。
 * 存下来这件事在这儿格外要紧 —— 那边重复请求只是费流量，这边费的是**免费额度**。
 */

/**
 * 云端音频的缓存键。
 *
 * 借用词典那个 `词|type` 的形状，把 type 那一格换成 `cloud:<音色>` ——
 * 同一个仓库里两边不会撞车（词典那边永远是数字 1 或 2）。
 */
export function cloudCacheKey(text: string, voiceType: string): string {
  return cacheKey(text, `cloud:${voiceType}` as unknown as number)
}

export function createCloudPlayer(
  getConfig: () => CloudTtsConfig = loadCloudConfig
): DictPlayer {
  /** 当前这一次的收尾。换一句或者被叫停时用它结束上一次 */
  let finish: ((cancelled: boolean) => void) | null = null
  /**
   * 每次发一个号。合成要等（联网一两秒），这中间用户完全可能已经点了别的 ——
   * 等回来不对号就直接放，放出来的是**上一句**。词典那边同一个坑，同一个办法。
   */
  let generation = 0

  function playBytes(bytes: ArrayBuffer): Promise<void> {
    const url = URL.createObjectURL(new Blob([bytes], { type: 'audio/mpeg' }))
    const audio = new Audio(url)
    audio.preload = 'auto'
    return new Promise<void>((resolve, reject) => {
      const settle = (cancelled: boolean, error?: Error) => {
        if (finish !== mine) return
        finish = null
        audio.onerror = audio.onended = null
        audio.pause()
        URL.revokeObjectURL(url)
        // 被叫停算正常结束 —— 当成失败的话上层会接着用系统引擎，
        // 把用户刚按停的那句再念一遍
        if (cancelled || !error) resolve()
        else reject(error)
      }
      const mine = settle
      finish = mine
      audio.onended = () => settle(false)
      audio.onerror = () => settle(false, new Error('合成回来的音频放不出来'))
      audio.play().catch(() => settle(false, new Error('放不出来')))
    })
  }

  return {
    async play(text) {
      const cfg = getConfig()
      // 没配 key 就当这条路不存在。抛 CloudNotConfigured 而不是普通错误，
      // 是让上层能分清「没开通」和「开通了但失败了」—— 前者不该惊动用户
      if (!isCloudReady(cfg)) throw new CloudNotConfigured('还没填云端朗读的 Key')

      const my = ++generation
      finish?.(true)
      const superseded = () => generation !== my

      const key = cloudCacheKey(text, cfg.voiceType)
      const cached = await getCached(key)
      if (superseded()) return
      if (cached) return playBytes(await cached.arrayBuffer())

      const bytes = await synthesizeCloud(cfg, text.trim(), newReqId())
      await putCached(key, bytes)
      if (superseded()) return
      return playBytes(bytes)
    },

    cancel() {
      generation++
      finish?.(true)
    }
  }
}
