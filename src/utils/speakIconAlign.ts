/**
 * 喇叭图标该按哪条中线摆。
 *
 * 图标紧跟在最后一个字母后面，所以对齐**那个字母**最自然：
 * 结尾是大写（COVID、I）就按大写高度居中，是小写（stumble）就按小写中线。
 * 数字按大写算 —— 衬线字体里的数字通常和大写一样高。
 *
 * 结尾的标点、引号、空格都跳过：句子多以句号结尾，真正决定观感的是它前面那个字母。
 */

export type IconAlign = 'cap' | 'x'

export function iconAlignFor(text: string): IconAlign {
  // 从后往前找第一个字母或数字
  const match = text.match(/[\p{L}\p{N}](?=[^\p{L}\p{N}]*$)/u)
  if (!match) return 'x' // 一个字母都没有：按小写摆，和从前一致

  const ch = match[0]
  if (/\p{Nd}/u.test(ch)) return 'cap' // 数字通常齐大写高
  // 有大小写之分的字母：大写才走 cap。中日韩这类没有大小写的，
  // toUpperCase 等于自身，会误判成大写，所以要求它「有小写形态」
  return ch !== ch.toLowerCase() ? 'cap' : 'x'
}
