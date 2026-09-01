import { isLookupWorthy } from './dictAudio'
import { patchForMachineVoice } from './pronounceFix'
import type { DictPlayer, Speaker } from './types'

/**
 * 「先真人，不行再机器」。
 *
 * 单词和短语先去取词典里人录的发音；取不到（生造词、不固定的组合、网络不通）
 * 就悄悄退回系统朗读 —— 用户拍板过：不弹提示、不做记号，照样出声就行。
 * 反正机器音本来就是从前的水平，退回去不算变差。
 *
 * **查不查由调用处传 `lookup` 说了算**：词卡和短语卡查，句摘卡不查。
 * 一开始这里是自己数空格判断的，短语接进来以后就不成立了 ——
 * 界面本来就知道点的是哪种卡片，没必要在这儿猜。
 */
export function createHumanFirstSpeaker(system: Speaker, player: DictPlayer): Speaker {
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
      system.cancel()

      const word = text.trim()
      if (options?.lookup && isLookupWorthy(word)) {
        try {
          await player.play(word)
          return
        } catch {
          // 没有真人录音，往下走系统朗读
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
      system.cancel()
    }
  }
}
