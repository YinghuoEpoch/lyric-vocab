import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { canOpenVoiceInstall, createSpeaker, openVoiceInstall, SpeechError } from '../speech'

/**
 * 复习页的朗读：点哪张卡就读哪张，同时只读一个。
 *
 * 谁在响用 id 记着，卡片据此把自己点亮 —— 不然连点几张分不清声音是哪来的。
 */

/**
 * 这一趟里已经被「知道了」掉的提示。
 *
 * 关掉一条就别再拿同一句话烦人：**朗读失败往往不是偶发，是这台设备的常态** ——
 * 没有引擎的机器上，每碰到一个词典里查不到的词都会失败一次，
 * 每次都弹同一条，读一页书要关十几回。
 *
 * 放在模块里而不是组件里：阅读页、生词板、复习页各有一份 useSpeak，
 * 放组件里就成了「每处各烦你一遍」。重开 app 就清空，装了引擎之后不会被旧记录挡住。
 */
const dismissed = new Set<string>()

export function useSpeak() {
  const speaker = useMemo(() => createSpeaker(), [])
  const [speakingId, setSpeakingId] = useState<string | null>(null)
  const [error, setError] = useState<{ message: string; missingVoice: boolean } | null>(null)
  /** 每次朗读发一个号，回调回来时对不上号就说明已经被后一次顶掉了 */
  const ticket = useRef(0)

  // 离开复习页 / 关掉 App 时别让声音还在响
  useEffect(() => () => speaker?.cancel(), [speaker])

  const speak = useCallback(
    (id: string, text: string, options: { lookup?: boolean } = {}) => {
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
      // 单个词读慢一点更听得清；整句按正常语速。
      // 放真人录音时这个语速用不上（录音本来就是人正常语速念的），
      // 只有退回机器音那条路才会用到
      const rate = text.trim().includes(' ') ? 1 : 0.85
      void speaker
        .speak(text, { rate, lookup: options.lookup })
        .catch((e) => {
          if (ticket.current !== mine) return
          const next =
            e instanceof SpeechError
              ? { message: e.message, missingVoice: e.missingVoice }
              : { message: '读不出来，检查一下系统的「文字转语音」设置', missingVoice: false }
          if (!dismissed.has(next.message)) setError(next)
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
    dismissError: useCallback(() => {
      setError((cur) => {
        if (cur) dismissed.add(cur.message)
        return null
      })
    }, [])
  }
}
