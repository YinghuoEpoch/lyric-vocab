import { SpeechError, type Speaker, type SpeakOptions } from './types'

/**
 * 用 WebView 自带的朗读能力发声（Web Speech API）。
 *
 * 它背后接的就是手机系统的语音引擎（安卓上通常是「Google 文字转语音」），
 * 所以不需要引任何库、也不需要联网 —— 前提是这台手机装了引擎和英文语音包。
 * 没装的话 speak 会直接报错，界面据此提示用户去系统设置里装。
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
          reject(new SpeechError(errorMessage(e.error)))
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

/** 把朗读引擎的错误码翻成人话 */
export function errorMessage(code: string | undefined): string {
  switch (code) {
    case 'not-allowed':
      return '系统不让自动发声，请先点一下屏幕再试'
    case 'language-unavailable':
    case 'voice-unavailable':
      return '这台手机没有英文语音，去系统设置里装一个「文字转语音」的英文语音包'
    case 'synthesis-unavailable':
    case 'synthesis-failed':
      return '手机的朗读引擎没能发声，检查一下系统的「文字转语音」设置'
    default:
      return '读不出来，检查一下系统的「文字转语音」设置'
  }
}
