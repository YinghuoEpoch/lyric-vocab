import { useEffect, useState } from 'react'
import { onKeyboardChange } from '../safeArea'

/**
 * 输入法此刻有多高（CSS 像素，没弹出来是 0）。
 *
 * 大部分避让用 CSS 变量 `--kb` 就够了（见 index.css）。这个钩子是给
 * **位置由 JS 算出来的东西**用的 —— 眼下只有长按取词那个贴着词的小窗：
 * 它得知道「屏幕能用的那一块变矮了」，否则会被键盘整个盖住。
 */
export function useKeyboardHeight(): number {
  const [kb, setKb] = useState(0)
  useEffect(() => onKeyboardChange(setKb), [])
  return kb
}
