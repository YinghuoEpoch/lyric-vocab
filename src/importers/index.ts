import type { ImportResult, Importer } from './types'
import { txtImporter } from './txt'
import { epubImporter } from './epub'
import { stripGutenbergBoilerplate } from './gutenberg'

/**
 * 导入器登记处。
 *
 * 以后加 epub / 字幕 / 拍照识别，只要写一个实现 Importer 的文件、
 * 在这个数组里加一行就行 —— 界面代码一个字都不用动，
 * 连文件选择器能选什么类型都会自动跟着变。
 */
const importers: Importer[] = [txtImporter, epubImporter]

/** 文件选择器的 accept 值，自动汇总所有已登记的格式 */
export const IMPORT_ACCEPT = importers.map((i) => i.accept).join(',')

/** 已支持的格式名，用于提示文案 */
export const IMPORT_FORMAT_NAMES = importers.map((i) => i.name).join('、')

/**
 * 解析一个文件。找不到能处理它的导入器时抛错，由上层提示用户。
 */
export async function importFile(file: File): Promise<ImportResult> {
  const importer = importers.find((i) => i.canHandle(file))
  if (!importer) {
    throw new Error(`不支持的文件格式，目前支持：${IMPORT_FORMAT_NAMES}`)
  }
  const result = await importer.parse(file)
  /**
   * 古登堡的书前后夹着几百行版权声明，剥掉。
   *
   * 放在这里而不是放在「书库」那条路里，是因为用户自己从别处下的古登堡书
   * 一样带着这段 —— 认的是文件内容里的界桩，不是来源，所以两条路都该受益。
   * 没有界桩就原样返回，对别的书没有任何影响。
   */
  return { ...result, chapters: stripGutenbergBoilerplate(result.chapters) }
}

export type { ImportResult, ImportedChapter, Importer } from './types'
