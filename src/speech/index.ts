import { Capacitor } from '@capacitor/core'
import type { Speaker } from './types'
import { createWebSpeaker, isWebSpeechAvailable } from './webSpeech'
import { createNativeSpeaker, openVoiceInstall } from './nativeSpeech'
import { createDictPlayer } from './dictAudio'
import { createHumanFirstSpeaker } from './humanFirst'
import { createCloudPlayer } from './cloudVoice'

/**
 * 朗读层入口。界面只跟这里打交道：问一句「能不能读」，要一个朗读器。
 *
 * **手机上走原生，浏览器里走 WebView 自带的那套。**
 * 不是两套都留着好玩 —— 安卓 WebView 没有网页版朗读接口（手机 Chrome 有，
 * WebView 没有），所以 App 里必须用原生插件；而开发时在电脑浏览器里调界面，
 * 那边没有原生插件，只能用网页版。两条路都收在这一个文件里，界面无需知道。
 *
 * **这两条都是「合成」，嗓子好不好看手机脸色。** 所以外面再包一层：
 * 单个词先取词典里人录的发音，取不到才落回合成（humanFirst.ts）。
 * 包在这里而不是改界面 —— 界面照旧只管「要一个朗读器」。
 */

function useNative(): boolean {
  return Capacitor.isNativePlatform() && Capacitor.isPluginAvailable('TextToSpeech')
}

export function isSpeechAvailable(): boolean {
  return useNative() || isWebSpeechAvailable()
}

/** 拿一个朗读器；这台设备两条路都走不通才返回 null */
export function createSpeaker(): Speaker | null {
  const system = useNative()
    ? createNativeSpeaker()
    : isWebSpeechAvailable()
      ? createWebSpeaker()
      : null
  if (!system) return null
  // 三级：真人录音 → 云端合成 → 这台机器的引擎。云端没配 key 就自动跳过，
  // 所以这里无条件挂上去，不必先问「配了没有」—— 见 humanFirst 的说明
  return createHumanFirstSpeaker(system, createDictPlayer(), createCloudPlayer())
}

/**
 * 能不能跳到系统的语音包安装界面（只有安卓能）。
 * 缺英文语音时界面据此给一个「去安装」的按钮。
 */
export function canOpenVoiceInstall(): boolean {
  return useNative()
}

export { openVoiceInstall }
export * from './cloudTts'
export * from './types'
