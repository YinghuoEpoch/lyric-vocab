import type { ImportedChapter } from './types'

/**
 * 剥掉古登堡电子书前后的版权声明。
 *
 * 古登堡每本书都在正文前后各夹一大段固定文字：前面是书名、作者、许可条款，
 * 后面是完整的授权协议加捐款说明，加起来三四百行。不剥掉的话：
 *
 * - 打开新导入的书，第一屏全是「The Project Gutenberg eBook of…」
 * - 短篇尤其离谱 —— 林肯的葛底斯堡演说正文才 270 个词，
 *   连着许可证一共 403 行，**正文占不到一成**
 * - 这些法律文本还会被一键划词当成正文去挑生词
 *
 * 好在古登堡自己留了界桩，几十年来格式没变过：
 *
 *     *** START OF THE PROJECT GUTENBERG EBOOK <书名> ***
 *     ...正文...
 *     *** END OF THE PROJECT GUTENBERG EBOOK <书名> ***
 *
 * 认这两行就够了。**找不到界桩就原样返回** —— 用户自己导入的书没有这东西，
 * 绝不能瞎猜着删。
 */

/** 界桩。星号数量偶有出入，中间的书名不管，所以两头都放松 */
const START = /\*\*\*\s*START OF (?:THE|THIS) PROJECT GUTENBERG EBOOK/i
const END = /\*\*\*\s*END OF (?:THE|THIS) PROJECT GUTENBERG EBOOK/i

/** 在章节列表里找出界桩落在第几章、第几行；找不到返回 null */
function locate(chapters: ImportedChapter[], marker: RegExp) {
  for (let c = 0; c < chapters.length; c++) {
    const lines = chapters[c].content.split('\n')
    for (let l = 0; l < lines.length; l++) {
      if (marker.test(lines[l])) return { chapter: c, line: l }
    }
  }
  return null
}

export function stripGutenbergBoilerplate(chapters: ImportedChapter[]): ImportedChapter[] {
  const start = locate(chapters, START)
  const end = locate(chapters, END)
  if (!start && !end) return chapters

  const out: ImportedChapter[] = []
  for (let c = 0; c < chapters.length; c++) {
    // 界桩之外的整章直接丢掉
    if (start && c < start.chapter) continue
    if (end && c > end.chapter) continue

    let lines = chapters[c].content.split('\n')
    // 先切尾再切头 —— 反过来的话行号会因为切头而整体前移，尾巴就切错位置了
    if (end && c === end.chapter) lines = lines.slice(0, end.line)
    if (start && c === start.chapter) lines = lines.slice(start.line + 1)

    const content = lines.join('\n').replace(/^\s*\n+/, '').replace(/\n+\s*$/, '')
    // 整章都是版权声明的，剥完就空了，不必留一个空章节占位
    if (content) out.push({ title: chapters[c].title, content })
  }

  // 万一界桩位置反常导致剥了个精光，宁可退回原样，也不能交出一本空书
  return out.length > 0 ? out : chapters
}
