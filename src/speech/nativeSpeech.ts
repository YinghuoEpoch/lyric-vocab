import { TextToSpeech } from '@capacitor-community/text-to-speech'
import { describeSpeechFailure } from './errors'
import { SpeechError, type Speaker } from './types'

/**
 * 安卓原生朗读。
 *
 * **为什么不用 WebView 自带的那套**：安卓的 WebView 压根没实现网页版朗读接口
 * （手机 Chrome 有，WebView 没有），所以在手机上连喇叭都画不出来。
 * 这里直接调系统的 TextToSpeech，绕开 WebView 这个坑。
 *
 * 插件的 speak 是「念完才返回」的，正好对得上我们的约定。
 */

export function createNativeSpeaker(): Speaker {
  return {
    async speak(text, options = {}) {
      const content = text.trim()
      if (!content) return

      // 上一句还在念就打断它：连点两个词，应该听到后一个，而不是排队等
      await TextToSpeech.stop().catch(() => {})

      try {
        await TextToSpeech.speak({
          text: content,
          lang: 'en-US',
          rate: options.rate ?? 1
        })
      } catch (e) {
        const failure = describeSpeechFailure(e)
        throw new SpeechError(failure.message, failure.missingVoice)
      }
    },

    cancel() {
      void TextToSpeech.stop().catch(() => {})
    }
  }
}

/**
 * 跳到系统的语音包安装界面（只有安卓有）。
 * 缺英文语音时给用户一条能照着走的路，比让他自己去设置里翻强。
 */
export async function openVoiceInstall(): Promise<void> {
  await TextToSpeech.openInstall().catch(() => {})
}

/** 这台手机的朗读引擎认不认英文 */
export async function isEnglishSupported(): Promise<boolean> {
  try {
    const { supported } = await TextToSpeech.isLanguageSupported({ lang: 'en-US' })
    return supported
  } catch {
    return true // 问不出来就别拦着，让用户点了再说
  }
}
