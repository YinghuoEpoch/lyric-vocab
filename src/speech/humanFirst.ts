import { isLookupWorthy } from './dictAudio'
import { patchForMachineVoice } from './pronounceFix'
import type { DictPlayer, Speaker } from './types'

/**
 * 「先真人，再云端，最后才是这台机器」。
 *
 * 三级，顺序是用户定的（后续规划.md 第五十八节）：
 *
 * 1. **真人录音**（只对词和短语）—— 人念的，比任何合成都好，而且不花云端的调用次数
 * 2. **云端合成** —— 句子、生造词，以及词典里查不到的那些
 * 3. **系统引擎** —— 兜底。用户原话「引擎是实在没网了再说」
 *
 * 从前只有 1 和 3，于是**没有朗读引擎的设备上，凡是查不到录音的都彻底没声音** ——
 * 他那台鸿蒙平板就是这样，句子一句也读不出来。
 *
 * **手机和平板一套逻辑，不做区分**（他的原话：「不用平板手机区分开」）。
 * 手机上引擎是好的，但也一样先走云端 —— 两台机器行为不一致比慢半秒更难受。
 *
 * **查不查词典由调用处传 `lookup` 说了算**：词卡和短语卡查，句摘卡不查。
 * 一开始这里是自己数空格判断的，短语接进来以后就不成立了 ——
 * 界面本来就知道点的是哪种卡片，没必要在这儿猜。
 *
 * 云端那一级**没配 key 就当不存在**（抛 CloudNotConfigured），直接落到系统引擎，
 * 不弹任何提示 —— 没开通云端的人不该被这件事打扰。
 */
export function createHumanFirstSpeaker(
  system: Speaker,
  player: DictPlayer,
  cloud?: DictPlayer
): Speaker {
  /**
   * 每次朗读发一个号。退回系统朗读之前要对一下号 ——
   * 取录音是要等的，这中间用户很可能已经点了别的词，
   * 那就不能再插进去念前一个。
   */
  let ticket = 0

  return {
    async speak(text, options) {
      const mine = ++ticket
      // 上一次不管在放录音还是在念，都先停掉。
      // 系统那边也要停：从前每次 speak 自己会先停一下，但现在这一次可能走的是
      // 放录音，不经过 system.speak —— 不主动停，上一句就会跟录音一起响。
      player.cancel()
      cloud?.cancel()
      system.cancel()

      const word = text.trim()
      if (options?.lookup && isLookupWorthy(word)) {
        try {
          await player.play(word)
          return
        } catch {
          // 没有真人录音，往下走云端
        }
      }

      if (ticket !== mine) return

      if (cloud) {
        try {
          await cloud.play(word)
          return
        } catch {
          // 没配 key、额度用完、网不通 —— 都往下走系统引擎。
          // 这里**不区分**是哪一种：三种的处理都一样，而真正的原因
          // 由「开发者 → 朗读引擎参数」里那颗「云端试读」原话奉上
        }
      }

      if (ticket !== mine) return
      // 到这儿说明要用机器音了 —— 先把这台引擎读不对的地方改掉再送出去
      return system.speak(patchForMachineVoice(text), options)
    },

    cancel() {
      // 号也要往前走一格：按停之后，那次取录音**无论怎么结束**都不该再落回系统朗读。
      // 光靠「放录音的那边被叫停时算正常结束」也能对，但那是指望另一个文件不改脾气；
      // 在这儿多走一格，谁改都不会把「按了停、却又念一遍」放出来。
      ticket++
      player.cancel()
      cloud?.cancel()
      system.cancel()
    }
  }
}
