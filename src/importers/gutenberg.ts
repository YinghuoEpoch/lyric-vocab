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

/**
 * 澳洲站（gutenberg.net.au）用的是另一套格式，没有上面那种界桩。
 *
 * 它的头部固定长这样：站名 → `Title:` / `Author:` / `eBook No.:` → 一段许可说明，
 * **最后一行永远是「To contact Project Gutenberg of Australia go to ...」**，
 * 之后往往还重复一次 `Title:` / `Author:` 才进正文。结尾则是一行光秃秃的站名。
 *
 * 抽查过《1984》《动物农场》《缅甸岁月》和一本澳洲地方志，四本格式完全一致。
 */
const AUS_HEAD = /^To contact Project Gutenberg of Australia/i
const AUS_FOOT = /^Project Gutenberg Australia\s*$/i
/**
 * 头部之后可能还跟着的：重复的标题行，以及一整行分隔用的横线。
 *
 * 横线这条是拿《Shooting an Elephant》验出来的 —— 它的头部收尾是
 * 「To contact… / 空行 / 一长串减号 / 空行 / Title: / Author:」。
 * 不认横线的话循环会卡在那一行，后面的 Title / Author 就跟着留下来了。
 */
const AUS_META = /^(Title|Author)\s*:/i
const AUS_RULE = /^[-=*_~]{3,}$/

/**
 * 头和尾要**各自独立**判断，不能「找不到头就整个放弃」。
 *
 * 这是拿真的《1984》验出来的：txt 导入器按「Chapter N」切章时，
 * 会把第一个章节标记**之前**的内容整段丢掉 —— 头部声明就在那里，
 * 于是章节里根本找不到头部标记。当时的写法是找不到头就 return null，
 * 结果尾巴那行站名原样留在了书的最后。
 */
function stripAustralian(chapters: ImportedChapter[]): ImportedChapter[] | null {
  const head = locate(chapters, AUS_HEAD)
  const last = chapters.length - 1
  const hasFoot =
    last >= 0 &&
    chapters[last].content
      .split('\n')
      .slice(-12)
      .some((l) => AUS_FOOT.test(l.trim()))
  if (!head && !hasFoot) return null

  return chapters
    .map((ch, c) => {
      if (head && c < head.chapter) return null
      let lines = ch.content.split('\n')

      /**
       * **先切头，再找尾，顺序不能反。**
       *
       * 头部第一行也是「Project Gutenberg Australia」，和结尾那行一模一样。
       * 先找尾的话，遇上短篇（整本就十来行）时，往回扫的窗口会一路够到头部那行，
       * 把整章切成空的 —— 写测试时当场撞到了。先把头切掉，那行就不在了。
       */
      if (head && c === head.chapter) {
        lines = lines.slice(head.line + 1)
        // 顺带吃掉后面重复的 Title / Author、分隔横线和空行
        while (
          lines.length &&
          (!lines[0].trim() || AUS_META.test(lines[0].trim()) || AUS_RULE.test(lines[0].trim()))
        ) {
          lines.shift()
        }
      }

      // 结尾那行站名：只在最后一章找，且必须靠近末尾，免得误伤正文里提到站名的地方
      if (c === chapters.length - 1) {
        for (let i = lines.length - 1; i >= Math.max(0, lines.length - 12); i--) {
          if (AUS_FOOT.test(lines[i].trim())) {
            lines = lines.slice(0, i)
            break
          }
        }
      }

      const content = lines.join('\n').replace(/^\s*\n+/, '').replace(/\n+\s*$/, '')
      return content ? { title: ch.title, content } : null
    })
    .filter((c): c is ImportedChapter => c !== null)
}

export function stripGutenbergBoilerplate(chapters: ImportedChapter[]): ImportedChapter[] {
  const start = locate(chapters, START)
  const end = locate(chapters, END)
  if (!start && !end) {
    const aus = stripAustralian(chapters)
    return aus && aus.length > 0 ? aus : chapters
  }

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
