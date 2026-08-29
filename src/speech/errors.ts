/**
 * 朗读失败时说什么。
 *
 * 单独一个文件、不碰任何插件，是为了能直接单测 ——
 * 各家（WebView 的错误码、安卓插件抛的异常）最后都收敛到这里。
 */

export interface SpeechFailure {
  /** 给用户看的一句话 */
  message: string
  /** 是不是「这台手机没有英文语音」—— 是的话界面可以给个「去安装」的入口 */
  missingVoice: boolean
}

/** 安卓朗读引擎缺语音数据时，报错文字里通常带这些字眼 */
const MISSING_VOICE = /language|voice|not\s*installed|missing\s*data|unsupported|不支持|未安装/i

export function describeSpeechFailure(raw: unknown): SpeechFailure {
  const detail = (raw instanceof Error ? raw.message : String(raw ?? '')).trim()

  if (!detail) {
    return { message: '读不出来，检查一下系统的「文字转语音」设置', missingVoice: false }
  }

  if (MISSING_VOICE.test(detail)) {
    return {
      message: '这台手机还没有英文语音，装一个就能读了',
      missingVoice: true
    }
  }

  return { message: `读不出来：${detail.slice(0, 120)}`, missingVoice: false }
}

/** WebView 那套朗读的错误码翻译（浏览器里开发时才会走到） */
export function describeWebSpeechError(code: string | undefined): SpeechFailure {
  switch (code) {
    case 'not-allowed':
      return { message: '系统不让自动发声，请先点一下屏幕再试', missingVoice: false }
    case 'language-unavailable':
    case 'voice-unavailable':
      return { message: '这台手机还没有英文语音，装一个就能读了', missingVoice: true }
    case 'synthesis-unavailable':
    case 'synthesis-failed':
      return { message: '手机的朗读引擎没能发声，检查一下系统的「文字转语音」设置', missingVoice: false }
    default:
      return { message: '读不出来，检查一下系统的「文字转语音」设置', missingVoice: false }
  }
}
