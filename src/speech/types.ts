/**
 * 朗读层的统一约定。
 *
 * 和导入层、填充层同一个思路：界面只认这份约定，具体由谁来发声
 * （现在是 WebView 自带的朗读，将来可能换成安卓原生插件）是可替换的实现。
 */

export interface Speaker {
  /** 读一段文字；念完（或被打断）才结束 */
  speak(text: string, options?: SpeakOptions): Promise<void>
  /** 立刻停下 */
  cancel(): void
}

/**
 * 放一段词典里人录好的发音。
 *
 * 和 Speaker 分开是因为它做的是另一件事：Speaker 是「把文字合成出来」，
 * 这里是「把现成的录音放出来」，而且**可能压根没有这个词的录音**（那就抛错）。
 */
export interface DictPlayer {
  /** 放这个词的录音；放完（或被叫停）才结束，没有录音则抛错 */
  play(word: string): Promise<void>
  /** 立刻停下 */
  cancel(): void
}

export interface SpeakOptions {
  /** 语速，1 是正常。单个单词读慢一点更听得清 */
  rate?: number
}

/** 朗读失败时抛这个，界面据此给一句人话 */
export class SpeechError extends Error {
  /** 是不是「这台手机没有英文语音」—— 是的话界面给一个「去安装」的入口 */
  missingVoice: boolean

  constructor(message: string, missingVoice = false) {
    super(message)
    this.missingVoice = missingVoice
  }
}
