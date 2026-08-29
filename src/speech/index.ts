import type { Speaker } from './types'
import { createWebSpeaker, isWebSpeechAvailable } from './webSpeech'

/**
 * 朗读层入口。
 *
 * 界面只跟这里打交道：问一句「能不能读」，要一个朗读器。
 * 现在用的是 WebView 自带的朗读；**要换成安卓原生插件，只改这个文件**。
 */

export function isSpeechAvailable(): boolean {
  return isWebSpeechAvailable()
}

/** 拿一个朗读器；这台手机不支持就返回 null */
export function createSpeaker(): Speaker | null {
  return isWebSpeechAvailable() ? createWebSpeaker() : null
}

export * from './types'
