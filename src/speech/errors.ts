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

/**
 * 这台设备**压根没有朗读引擎**时插件说的话。
 *
 * 和「有引擎但缺英文」是两码事，所以先认它、再认上面那条 ——
 * 这句里带着 language 之外的字眼，顺序反了会被误判成缺语音。
 *
 * 真实来历（后续规划.md 第五十七节）：用户的鸿蒙平板用卓易通跑这个 app，
 * 那层兼容环境里一个朗读引擎都没有，于是启动时申请引擎就失败了。
 * 这种情况**给「去安装」按钮是骗人的** —— 那颗键跳的是系统的语音包安装页，
 * 而这台设备连那个页面都没有，点了什么也不会发生。
 */
const NO_ENGINE = /not\s*yet\s*initialized|not\s*available\s*on\s*this\s*device/i

export function describeSpeechFailure(raw: unknown): SpeechFailure {
  const detail = (raw instanceof Error ? raw.message : String(raw ?? '')).trim()

  if (!detail) {
    return { message: '读不出来，检查一下系统的「文字转语音」设置', missingVoice: false }
  }

  if (NO_ENGINE.test(detail)) {
    return {
      message: '这台设备没有可用的朗读引擎，只有网上查得到发音的词能读',
      missingVoice: false
    }
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
