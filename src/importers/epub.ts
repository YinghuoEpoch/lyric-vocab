import { unzip, strFromU8 } from 'fflate'
import type { Importer, ImportedChapter } from './types'
import {
  parseContainer,
  parseOpf,
  parseToc,
  htmlToText,
  extractDocTitle
} from './epubParts'

/**
 * EPUB 导入。
 *
 * epub 本质是个 zip 包，里面按固定约定摆放：
 *   META-INF/container.xml  ->  指向 OPF 文件
 *   OPF                     ->  书名、正文文件清单、阅读顺序、目录文件位置
 *   目录（nav 或 ncx）        ->  每个正文文件对应的章节标题
 *   正文                     ->  一份份 XHTML
 *
 * 解析出来后按本 app 的约定组装：一个 epub = 一个文库，一个正文文件 = 一篇文档。
 */

/** 解压成 { 包内路径: 字节 }。用异步版，避免大部头电子书把界面卡住。 */
function unzipFile(data: Uint8Array): Promise<Record<string, Uint8Array>> {
  return new Promise((resolve, reject) => {
    unzip(data, (err, files) => (err ? reject(err) : resolve(files)))
  })
}

/** 取出某个文件并按 UTF-8 解码；不存在时返回 null */
function readEntry(files: Record<string, Uint8Array>, path: string): string | null {
  const entry = files[path]
  return entry ? strFromU8(entry) : null
}

export const epubImporter: Importer = {
  name: 'EPUB 电子书',
  accept: '.epub,application/epub+zip',

  canHandle(file) {
    return /\.epub$/i.test(file.name) || file.type === 'application/epub+zip'
  },

  async parse(file) {
    const fallbackName = file.name.replace(/\.epub$/i, '') || '导入电子书'
    const files = await unzipFile(new Uint8Array(await file.arrayBuffer()))

    const containerXml = readEntry(files, 'META-INF/container.xml')
    if (!containerXml) throw new Error('这个 epub 缺少 META-INF/container.xml，文件可能已损坏')

    const opfPath = parseContainer(containerXml)
    if (!opfPath) throw new Error('这个 epub 的 container.xml 里没有指明正文位置')

    const opfXml = readEntry(files, opfPath)
    if (!opfXml) throw new Error(`这个 epub 里找不到 ${opfPath}`)

    const { title, spine, tocPath } = parseOpf(opfXml, opfPath)

    // 目录能提供最准确的章节名；没有也不影响导入
    const tocTitles = (() => {
      if (!tocPath) return new Map<string, string>()
      const tocXml = readEntry(files, tocPath)
      return tocXml ? parseToc(tocXml, tocPath) : new Map<string, string>()
    })()

    const chapters: ImportedChapter[] = []
    for (const path of spine) {
      const html = readEntry(files, path)
      if (!html) continue

      const content = htmlToText(html)
      // 封面、空白页之类没有正文的直接跳过
      if (!content.trim()) continue

      const chapterTitle =
        tocTitles.get(path) || extractDocTitle(html) || `第 ${chapters.length + 1} 章`

      chapters.push({ title: chapterTitle, content })
    }

    if (chapters.length === 0) {
      throw new Error('这个 epub 里没有找到可读的正文')
    }

    return {
      bookName: title || fallbackName,
      chapters,
      // epub 天然是分章节的，导入后不需要提示「未识别到章节」
      hasChapters: true
    }
  }
}
