/**
 * 导入层的统一约定。
 *
 * 不管来源是什么（txt、epub、字幕、拍照识别的文字……），最终都归到同一种形状：
 *
 *     任何输入 -> { 书名, 章节: [{ 标题, 正文 }] }
 *
 * 这样新增一种格式只需要写一个实现了 Importer 的小文件，不必去改界面代码。
 */

export interface ImportedChapter {
  title: string
  content: string
}

export interface ImportResult {
  /** 建议的文库名，通常取自文件名 */
  bookName: string
  chapters: ImportedChapter[]
  /**
   * 是否真的识别出了章节。
   * false 表示整份内容作为单篇文档导入 —— 上层据此决定要不要提示用户。
   */
  hasChapters: boolean
}

export interface Importer {
  /** 供界面显示的名称 */
  name: string
  /** 文件选择器的 accept 值，例如 '.txt,text/plain' */
  accept: string
  /** 这个导入器能不能处理该文件 */
  canHandle(file: File): boolean
  parse(file: File): Promise<ImportResult>
}

/** 按指定编码把文件读成文本 */
export function readFileAsText(file: File, encoding: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => resolve((reader.result ?? '') as string)
    reader.onerror = () => reject(reader.error ?? new Error('读取文件失败'))
    reader.readAsText(file, encoding)
  })
}
