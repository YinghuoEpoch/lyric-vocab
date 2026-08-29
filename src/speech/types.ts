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

export interface SpeakOptions {
  /** 语速，1 是正常。单个单词读慢一点更听得清 */
  rate?: number
}

/** 朗读失败时抛这个，界面据此给一句人话 */
export class SpeechError extends Error {}
