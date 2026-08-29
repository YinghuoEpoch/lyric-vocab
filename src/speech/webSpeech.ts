import { describeWebSpeechError } from './errors'
import { SpeechError, type Speaker, type SpeakOptions } from './types'

/**
 * 用 WebView 自带的朗读能力发声（Web Speech API）。
 *
 * **这条路只在电脑浏览器里走得通**：安卓的 WebView 没有实现网页版朗读接口
 * （手机 Chrome 有，WebView 没有），所以装成 App 之后走的是 nativeSpeech.ts。
 * 留着它是为了开发时能在浏览器里调界面。
 */

/**
 * 挑一个英文嗓子。
 *
 * 优先**本地合成**（离线可用、开口快），其次 en-US。
 * 挑不到英文就返回 undefined —— 那就交给系统按 utterance.lang 自己看着办，
 * 总比拿一个中文嗓子去念英文强。
 */
export function pickEnglishVoice(
  voices: Array<{ lang: string; localService?: boolean; name?: string }>
): { lang: string; localService?: boolean; name?: string } | undefined {
  const english = voices.filter((v) => /^en[-_]?/i.test(v.lang))
  if (english.length === 0) return undefined
  const score = (v: { lang: string; localService?: boolean }) =>
    (v.localService ? 2 : 0) + (/^en[-_]us/i.test(v.lang) ? 1 : 0)
  return english.slice().sort((a, b) => score(b) - score(a))[0]
}

/**
 * 念完大概要多久。
 *
 * 安卓 WebView 上 onend 偶尔不来 —— 真发生了的话高亮就一直挂着，
 * 界面看起来像卡死。所以估一个上限兜底，到点就当念完了。
 */
export function estimateDurationMs(text: string, rate = 1): number {
  const base = 500 + text.length * 90
  return Math.min(Math.round(base / Math.max(rate, 0.1)), 20000)
}

export function isWebSpeechAvailable(): boolean {
  return (
    typeof window !== 'undefined' &&
    typeof window.speechSynthesis !== 'undefined' &&
    typeof window.SpeechSynthesisUtterance !== 'undefined'
  )
}

export function createWebSpeaker(): Speaker {
  const synth = window.speechSynthesis
  let timer: number | undefined

  /**
   * 嗓子列表是异步加载的，第一次问往往是空的。
   * 不为它专门等 —— 拿不到就先用系统默认的念，下一次自然就有了。
   */
  const voiceOf = () => pickEnglishVoice(synth.getVoices() as unknown as Array<{ lang: string }>)

  const clearTimer = () => {
    if (timer !== undefined) {
      clearTimeout(timer)
      timer = undefined
    }
  }

  return {
    speak(text, options: SpeakOptions = {}) {
      const content = text.trim()
      if (!content) return Promise.resolve()

      // 上一句还在念就打断它：连点两个词，应该听到后一个，而不是排队等
      synth.cancel()
      clearTimer()

      return new Promise<void>((resolve, reject) => {
        const utterance = new window.SpeechSynthesisUtterance(content)
        utterance.lang = 'en-US'
        utterance.rate = options.rate ?? 1
        const voice = voiceOf()
        if (voice) utterance.voice = voice as unknown as SpeechSynthesisVoice

        let settled = false
        const finish = () => {
          if (settled) return
          settled = true
          clearTimer()
          resolve()
        }

        utterance.onend = finish
        utterance.onerror = (e) => {
          if (settled) return
          settled = true
          clearTimer()
          // 被自己的 cancel 打断不算出错
          if (e.error === 'interrupted' || e.error === 'canceled') return resolve()
          const failure = describeWebSpeechError(e.error)
          reject(new SpeechError(failure.message, failure.missingVoice))
        }
        // onend 没来时的兜底
        timer = window.setTimeout(finish, estimateDurationMs(content, utterance.rate) + 1500)

        synth.speak(utterance)
      })
    },

    cancel() {
      clearTimer()
      synth.cancel()
    }
  }
}
