import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { canOpenVoiceInstall, createSpeaker, openVoiceInstall, SpeechError } from '../speech'

/**
 * 复习页的朗读：点哪张卡就读哪张，同时只读一个。
 *
 * 谁在响用 id 记着，卡片据此把自己点亮 —— 不然连点几张分不清声音是哪来的。
 */

export function useSpeak() {
  const speaker = useMemo(() => createSpeaker(), [])
  const [speakingId, setSpeakingId] = useState<string | null>(null)
  const [error, setError] = useState<{ message: string; missingVoice: boolean } | null>(null)
  /** 每次朗读发一个号，回调回来时对不上号就说明已经被后一次顶掉了 */
  const ticket = useRef(0)

  // 离开复习页 / 关掉 App 时别让声音还在响
  useEffect(() => () => speaker?.cancel(), [speaker])

  const speak = useCallback(
    (id: string, text: string) => {
      if (!speaker) return
      const mine = ++ticket.current

      // 点正在响的那张 = 停下来
      if (speakingId === id) {
        speaker.cancel()
        setSpeakingId(null)
        return
      }

      setError(null)
      setSpeakingId(id)
      // 单个词读慢一点更听得清；整句按正常语速
      const rate = text.trim().includes(' ') ? 1 : 0.85
      void speaker
        .speak(text, { rate })
        .catch((e) => {
          if (ticket.current !== mine) return
          setError(
            e instanceof SpeechError
              ? { message: e.message, missingVoice: e.missingVoice }
              : { message: '读不出来，检查一下系统的「文字转语音」设置', missingVoice: false }
          )
        })
        .finally(() => {
          if (ticket.current === mine) setSpeakingId(null)
        })
    },
    [speaker, speakingId]
  )

  return {
    /** 这台手机能不能读；不能就别把喇叭图标画出来 */
    canSpeak: speaker !== null,
    speakingId,
    speak,
    error,
    /** 缺英文语音时，安卓上可以直接跳到系统的安装界面；浏览器里没有这条路 */
    installVoice: canOpenVoiceInstall() ? () => void openVoiceInstall() : null,
    dismissError: useCallback(() => setError(null), [])
  }
}
