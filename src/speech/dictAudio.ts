import type { DictPlayer } from './types'

/**
 * 词典的真人发音。
 *
 * 系统朗读的嗓子好不好，取决于这台手机装了什么引擎 —— 厂商自带的引擎中文做得好，
 * 英文往往只塞一个凑合的嗓子，而且换不掉。所以单词不走合成，直接取词典里
 * **人录好的** mp3 放出来。
 *
 * **只对单个词有效**：整句词典里没有，一律取不到（见 isSingleWord）。
 * 取不到就抛错，由上层退回系统朗读 —— 这里不做兜底，兜底是入口那一层的事。
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
 * 词典收的是词条，整句查不到 —— 与其每点一句都白跑一趟网络再退回来，
 * 不如一开始就不查。带空格的（句子、以及暂时还没接进来的短语）直接走系统朗读。
 */
export function isSingleWord(text: string): boolean {
  const t = text.trim()
  return t.length > 0 && !/\s/.test(t)
}

export function dictAudioUrl(word: string, type: number = AMERICAN): string {
  return `${BASE}?audio=${encodeURIComponent(word.trim())}&type=${type}`
}

/**
 * 用一个 audio 元素放，不用 fetch —— 这个地址不带跨域许可，
 * fetch 会被浏览器拦下来，而 audio 标签放外站的声音是不受这条限制的。
 * （将来要把录音存下来离线用，那就得走 Capacitor 的原生网络绕开跨域，不是这里的事。）
 */
export function createDictPlayer(type: number = AMERICAN): DictPlayer {
  /** 当前这次播放的收尾函数；换一个词或者被叫停时用它把上一次结束掉 */
  let finishCurrent: ((cancelled: boolean) => void) | null = null

  return {
    play(word) {
      finishCurrent?.(true)

      const audio = new Audio(dictAudioUrl(word, type))
      audio.preload = 'auto'

      return new Promise<void>((resolve, reject) => {
        let timer: number | undefined

        const settle = (cancelled: boolean, error?: Error) => {
          if (finishCurrent !== finish) return
          finishCurrent = null
          if (timer !== undefined) clearTimeout(timer)
          audio.onerror = audio.onended = audio.onplaying = null
          audio.pause()
          // 被叫停算正常结束，不能当成「没有录音」—— 否则上层会接着用系统朗读
          // 把用户刚按停的词再念一遍
          if (cancelled || !error) resolve()
          else reject(error)
        }
        const finish = settle
        finishCurrent = finish

        // 服务器说没有这个词条（返回的不是音频），或者根本放不出来
        audio.onerror = () => settle(false, new Error('没有这个词的真人录音'))
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
    },

    cancel() {
      finishCurrent?.(true)
    }
  }
}
