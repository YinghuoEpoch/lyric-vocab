import type { ReaderSettings } from '../types'

/**
 * 三种纸色（标准 / 青灰 / 暖白）的配色表。
 *
 * 从前写在 `LyricEditor` 内部，所以主题只染得到阅读页，复习页底色是写死的。
 * 搬出来给两边共用，复习模式才能跟着换。
 *
 * 只管正文/卡片所在的那块滚动区，顶部的带和左右侧栏都不用它。
 */
export function readerThemeStyles(theme: ReaderSettings['theme']) {
  return theme === 'original'
    ? { bg: 'bg-[#f8f9f8]', text: 'text-[#2c3e34]', border: 'border-[#2c3e34]/12' }
    : theme === 'rice'
      ? { bg: 'bg-[#fffefc]', text: 'text-[#333333]', border: 'border-accent-900/10' }
      : { bg: 'bg-white', text: 'text-gray-900', border: 'border-gray-200' }
}
