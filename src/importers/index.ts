import type { ImportResult, Importer } from './types'
import { txtImporter } from './txt'
import { epubImporter } from './epub'

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
  return importer.parse(file)
}

export type { ImportResult, ImportedChapter, Importer } from './types'
