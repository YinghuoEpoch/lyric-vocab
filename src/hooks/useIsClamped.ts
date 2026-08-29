import { useLayoutEffect, useRef, useState } from 'react'
import { isClamped } from '../utils/isClamped'

/**
 * 盯着一个元素，看它的内容有没有被截断。
 *
 * `enabled` 一定要在**展开时传 false**：展开之后截断类名已经去掉了，
 * 这时候再测必然得出「没被截断」，于是「能不能展开」立刻翻假 ——
 * 卡片会自己缩回去，来回抖。所以展开期间不测，沿用上一次的结果。
 *
 * 侧栏宽度会变（手机/宽屏、横竖屏），所以用 ResizeObserver 跟着重测，
 * 不是只在挂载时量一次。
 */
export function useIsClamped<T extends HTMLElement>(enabled: boolean, watch: unknown) {
  const ref = useRef<T>(null)
  const [clamped, setClamped] = useState(false)

  useLayoutEffect(() => {
    const el = ref.current
    if (!el || !enabled) return
    const measure = () => setClamped(isClamped(el))
    measure()
    if (typeof ResizeObserver === 'undefined') return
    const ro = new ResizeObserver(measure)
    ro.observe(el)
    return () => ro.disconnect()
  }, [enabled, watch])

  return { ref, clamped }
}
