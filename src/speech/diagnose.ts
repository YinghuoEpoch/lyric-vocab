import { Capacitor } from '@capacitor/core'
import { TextToSpeech } from '@capacitor-community/text-to-speech'
import { isCloudReady, newReqId, synthesizeCloud, type CloudTtsConfig } from './cloudTts'

/**
 * 朗读引擎读数。
 *
 * 起因（后续规划.md 第五十七节）：用户平板上只有真人录音的词能响，
 * 凡是过系统朗读引擎的一概没声音；但**无障碍的「屏幕朗读」能念英文** ——
 * 所以引擎和英文数据都在，是我们这条路没走通。
 *
 * 这台电脑上没有安卓的朗读引擎，我验不了，所以按第四十九节那条老办法：
 * **先做一屏读数，别猜。** 那次加完读数，前两轮的猜测一轮就定案。
 *
 * ⚠️ **这里直接调插件，不经过 humanFirst / nativeSpeech**，两个原因：
 *
 * 1. 要绕开真人录音 —— 走那条壳的话，`hello` 会放下载来的 mp3，
 *    正好把要查的那条路整个跳过去，读数就成了假的
 * 2. 要**报错的原文**。nativeSpeech 会把异常翻译成给用户看的一句话，
 *    诊断要的恰恰是被它盖掉的那一层
 */

/** 一次「问引擎」的结果：问出来了什么，或者它报了什么错 */
export type Answer = { ok: true; value: string } | { ok: false; error: string }

function ok(value: string): Answer {
  return { ok: true, value }
}

function fail(e: unknown): Answer {
  const msg = (e instanceof Error ? e.message : String(e ?? '')).trim()
  return { ok: false, error: msg || '报了个空错误' }
}

export interface SpeechDiagnosis {
  /** 是不是装成 app 在跑（浏览器里没有原生插件，读数没意义） */
  native: boolean
  /** 插件挂上了没有 */
  pluginAvailable: boolean
  /** 问它「你认 en-US 吗」 */
  english: Answer
  /** 它报得出的语言里，英文那几个 */
  englishLangs: Answer
  /** 语言总共几个（一个都没有 = 引擎其实没起来） */
  langCount: Answer
  /** 英文嗓子：名字，以及要不要联网 */
  englishVoices: Answer
  /** 嗓子总共几个 */
  voiceCount: Answer
}

/**
 * 问引擎四件事。**每一问单独包起来**：
 * 其中一问炸了不该把整屏读数拖没 —— 那样就又回到「什么都不知道」了。
 */
export async function diagnoseSpeech(): Promise<SpeechDiagnosis> {
  const native = Capacitor.isNativePlatform()
  const pluginAvailable = Capacitor.isPluginAvailable('TextToSpeech')

  let english: Answer
  try {
    const { supported } = await TextToSpeech.isLanguageSupported({ lang: 'en-US' })
    english = ok(supported ? '认' : '不认')
  } catch (e) {
    english = fail(e)
  }

  let englishLangs: Answer
  let langCount: Answer
  try {
    const { languages } = await TextToSpeech.getSupportedLanguages()
    const list = (languages ?? []).map(String)
    const en = list.filter((l) => /^en/i.test(l))
    langCount = ok(String(list.length))
    englishLangs = ok(en.length ? en.join('、') : '一个都没有')
  } catch (e) {
    englishLangs = fail(e)
    langCount = fail(e)
  }

  let englishVoices: Answer
  let voiceCount: Answer
  try {
    const { voices } = await TextToSpeech.getSupportedVoices()
    const list = voices ?? []
    voiceCount = ok(String(list.length))
    const en = list.filter((v) => /^en/i.test(String(v.lang ?? '')))
    englishVoices = ok(
      en.length
        ? en
            .slice(0, 6)
            // localService 为假 = 这条嗓子要联网才出声
            .map((v) => `${v.voiceURI ?? v.name}${v.localService === false ? '（要联网）' : ''}`)
            .join('，')
        : '一个都没有'
    )
  } catch (e) {
    englishVoices = fail(e)
    voiceCount = fail(e)
  }

  return { native, pluginAvailable, english, englishLangs, langCount, englishVoices, voiceCount }
}

/** 试读一次的结果 */
export interface TryReadResult {
  /** 引擎说成功了还是失败了 */
  ok: boolean
  /** 从按下去到它返回，花了多少毫秒 */
  ms: number
  /** 失败时的原文 */
  error?: string
}

/**
 * 试读一句，掐表。
 *
 * **耗时这一格是关键**，它把两种「没声音」分开：
 *
 * - 说成功、但**几乎立刻**返回 → 引擎压根没开口（报成功不出声，最阴的一种）
 * - 说成功、耗时和一句话的长度差不多 → 它真的念了，声音丢在别处（音量、通道、被谁抢了）
 *
 * 插件的 speak 是「念完才返回」的，所以这个数有意义。
 */
export async function tryRead(text: string, lang: string): Promise<TryReadResult> {
  const t0 = Date.now()
  try {
    await TextToSpeech.speak({ text, lang, rate: 1 })
    return { ok: true, ms: Date.now() - t0 }
  } catch (e) {
    const msg = (e instanceof Error ? e.message : String(e ?? '')).trim()
    return { ok: false, ms: Date.now() - t0, error: msg || '报了个空错误' }
  }
}

/** 三句试读料。中文那一句是**分水岭**：中文能读、英文不能，就是缺英文数据而不是引擎的事 */
export const TRY_SAMPLES = [
  { key: 'word', label: '读一个英文词', text: 'hello', lang: 'en-US' },
  { key: 'sentence', label: '读一句英文', text: 'I never stood up very tall', lang: 'en-US' },
  { key: 'chinese', label: '读一句中文', text: '你好，这是一句中文', lang: 'zh-CN' }
] as const

/**
 * 云端试读。
 *
 * **这颗按钮是用户能自己查下去的唯一凭据** —— 我手上没有他的 Key，
 * 验不了通不通，只能把服务商的原话原样交给他：
 * Key 填错、额度用完、服务没开通、音色名不对，火山各有各的说法，
 * 而这四种的处理办法完全不同。翻译成一句「读不出来」等于把线索扔了。
 *
 * 走的是**和真正朗读同一条路**（synthesizeCloud），不是另写一个请求 ——
 * 试读通了而实际用不了，那种诊断还不如没有。
 */
export async function tryCloudRead(cfg: CloudTtsConfig): Promise<TryReadResult> {
  const t0 = Date.now()
  if (!isCloudReady(cfg)) {
    return { ok: false, ms: 0, error: '还没填全（应用 ID / 令牌 / 音色，三样都要）' }
  }
  try {
    const bytes = await synthesizeCloud(cfg, CLOUD_SAMPLE, newReqId())
    const ms = Date.now() - t0
    if (bytes.byteLength < 200) {
      return { ok: false, ms, error: `拿回来的音频只有 ${bytes.byteLength} 字节，不像是一句话` }
    }
    // 拿到音频就当场放出来 —— 「有没有声音」才是用户真正要验的那件事
    const url = URL.createObjectURL(new Blob([bytes], { type: 'audio/mpeg' }))
    const audio = new Audio(url)
    void audio.play().catch(() => {})
    audio.onended = () => URL.revokeObjectURL(url)
    return { ok: true, ms, error: `拿到 ${bytes.byteLength} 字节，正在放` }
  } catch (e) {
    const msg = (e instanceof Error ? e.message : String(e ?? '')).trim()
    return { ok: false, ms: Date.now() - t0, error: msg || '报了个空错误' }
  }
}

/** 试读用的句子。用英文，因为要验的正是「这个音色念不念得了英文」 */
export const CLOUD_SAMPLE = 'I never stood up very tall'
