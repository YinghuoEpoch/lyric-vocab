import type { Importer, ImportResult } from './types'
import { readFileAsText } from './types'

/**
 * 纯文本导入。
 *
 * 两件事：按章节标题切分，以及应付 GBK 编码的中文 txt。
 */

/**
 * 章节标题的识别规则。支持：
 * - 中文「第 N 章 / 回 / 节 / 卷 / 集 / 部」，N 可以是阿拉伯数字或中文数字
 * - Chapter 后接任意内容
 * - 宽间距的 C H A P T E R（某些排版会把字母拆开）
 * - Session N
 * - Markdown 的 ### 标题
 * - Part 后接任意内容
 */
export const CHAPTER_PATTERN =
  /^\s*(?:第\s*[0-9零一二三四五六七八九十百千]+\s*[章回节卷集部]|Chapter\s+.*|C\s*H\s*A\s*P\s*T\s*E\s*R\s+.*|Session\s+\d+|###\s*.*|Part\s+.*).*$/gim

/**
 * 按章节标题把整份文本切开。
 *
 * 一个字都没匹配到时，整篇作为一个章节返回，并把 hasChapters 置为 false，
 * 让上层去提示「未识别到章节」。
 *
 * 这是个纯函数，可以直接测 —— 从前它埋在组件的回调里，没法单独验证。
 */
export function splitChapters(raw: string, fallbackTitle: string): ImportResult {
  const normalized = (raw ?? '').replace(/\r\n/g, '\n')
  const chapters: ImportResult['chapters'] = []
  // 正则带 g 标志会保留 lastIndex，每次调用都得新建一个，否则第二次调用会从上次的位置续着找
  const regex = new RegExp(CHAPTER_PATTERN.source, 'gim')

  let currentTitle: string | null = null
  let lastIndex = 0
  let match: RegExpExecArray | null

  while ((match = regex.exec(normalized)) !== null) {
    const header = match[0].trim()
    const start = match.index

    // 上一章的正文 = 上个标题结束处 到 这个标题开始处
    if (currentTitle !== null) {
      const body = normalized.slice(lastIndex, start).trim()
      if (body) chapters.push({ title: currentTitle, content: body })
    }

    currentTitle = header
    lastIndex = regex.lastIndex
  }

  // 收尾：最后一章
  if (currentTitle !== null) {
    const body = normalized.slice(lastIndex).trim()
    if (body) chapters.push({ title: currentTitle, content: body })
  }

  if (chapters.length === 0) {
    return {
      bookName: fallbackTitle,
      chapters: [{ title: fallbackTitle, content: normalized }],
      hasChapters: false
    }
  }

  return { bookName: fallbackTitle, chapters, hasChapters: true }
}

export const txtImporter: Importer = {
  name: '纯文本',
  accept: '.txt,text/plain',

  canHandle(file) {
    return /\.txt$/i.test(file.name) || file.type === 'text/plain'
  },

  async parse(file) {
    const fallbackTitle = file.name.replace(/\.txt$/i, '') || '导入文本'

    const utf8Result = splitChapters(await readFileAsText(file, 'utf-8'), fallbackTitle)
    if (utf8Result.hasChapters) return utf8Result

    // 一个章节都没识别出来，有可能是 GBK 编码的中文 txt 被按 utf-8 读成了乱码，
    // 换个编码再试一次；如果这次能认出章节，说明猜对了。
    try {
      const gbkResult = splitChapters(await readFileAsText(file, 'gbk'), fallbackTitle)
      if (gbkResult.hasChapters) return gbkResult
    } catch {
      // 读 GBK 失败就沿用 utf-8 的结果
    }

    return utf8Result
  }
}
