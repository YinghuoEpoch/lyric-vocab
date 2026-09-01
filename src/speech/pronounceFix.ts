/**
 * 送给机器音之前的读音补丁。
 *
 * **卡片上显示的文字，和发给朗读引擎的文字，本来就不必是同一份。**
 * 这台手机的引擎在「把文字变成读音」这一步偷懒：夹在词中间的冠词 `a`
 * 被它认成了字母名，`with a thud` 听着就是「with 字母A thud」。
 *
 * 好引擎不会犯这个错，所以这不是我们的问题 —— 但引擎换不掉（这台手机只有厂商自带的
 * 一个，英语底下连第二个嗓子都没有），只能在送出去之前把字改一下绕过它。
 *
 * **只用在退回机器音这条路上**：走真人录音时压根不经过这里。
 */

/**
 * 补丁表：原词（小写）→ 换成什么送给引擎。
 *
 * 做成一张表是因为这类毛病只能一个个撞出来 —— 引擎哪里读错了，
 * 得有人听见才知道。以后再发现，来这儿加一行就行。
 *
 * - `a`：冠词。`uh` 的音（/ʌ/）跟冠词该有的轻音几乎一样，
 *   而且它是个正常单词，引擎不会再往字母上想
 */
const PATCHES: Record<string, string> = {
  a: 'uh'
}

/**
 * 把一段文字改写成「引擎读得对」的样子。
 *
 * **只在多个词的时候改。** 单独一个词的时候不改是有道理的：
 * 你要真把 `a` 当生词标下来了，那读成字母音才是对的 —— 词典里查 `a` 给的就是那个。
 * 出问题的从来是它夹在句子中间当冠词的时候。
 */
export function patchForMachineVoice(text: string): string {
  const trimmed = text.trim()
  // 词与词之间的空白照原样留着，只换词本身
  const parts = trimmed.split(/(\s+)/)
  const words = parts.filter((p) => !/^\s*$/.test(p))
  if (words.length < 2) return trimmed

  return parts
    .map((part) => {
      if (/^\s*$/.test(part)) return part
      // 词两头可能贴着标点（句末的 a. 、引号里的 "a"），只拿中间的字母去对表
      const m = part.match(/^([^\p{L}\p{N}]*)(.*?)([^\p{L}\p{N}]*)$/u)
      if (!m) return part
      const [, before, core, after] = m
      const patch = PATCHES[core.toLowerCase()]
      return patch === undefined ? part : before + patch + after
    })
    .join('')
}
