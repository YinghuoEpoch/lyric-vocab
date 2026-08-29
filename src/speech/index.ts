import { Capacitor } from '@capacitor/core'
import type { Speaker } from './types'
import { createWebSpeaker, isWebSpeechAvailable } from './webSpeech'
import { createNativeSpeaker, openVoiceInstall } from './nativeSpeech'

/**
 * 朗读层入口。界面只跟这里打交道：问一句「能不能读」，要一个朗读器。
 *
 * **手机上走原生，浏览器里走 WebView 自带的那套。**
 * 不是两套都留着好玩 —— 安卓 WebView 没有网页版朗读接口（手机 Chrome 有，
 * WebView 没有），所以 App 里必须用原生插件；而开发时在电脑浏览器里调界面，
 * 那边没有原生插件，只能用网页版。两条路都收在这一个文件里，界面无需知道。
 */

function useNative(): boolean {
  return Capacitor.isNativePlatform() && Capacitor.isPluginAvailable('TextToSpeech')
}

export function isSpeechAvailable(): boolean {
  return useNative() || isWebSpeechAvailable()
}

/** 拿一个朗读器；这台设备两条路都走不通才返回 null */
export function createSpeaker(): Speaker | null {
  if (useNative()) return createNativeSpeaker()
  return isWebSpeechAvailable() ? createWebSpeaker() : null
}

/**
 * 能不能跳到系统的语音包安装界面（只有安卓能）。
 * 缺英文语音时界面据此给一个「去安装」的按钮。
 */
export function canOpenVoiceInstall(): boolean {
  return useNative()
}

export { openVoiceInstall }
export * from './types'
