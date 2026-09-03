import { useRef, useState } from 'react'

/**
 * 一根可以拖的分栏杆：管着某一侧栏有多宽，并把宽度记住。
 *
 * 起因是用户在平板上说「左侧栏目录省略太严重」—— 250px 里真正留给文档名的只有
 * 111px，一半以上被缩进、图标和「⋯」吃掉了，九章书全成了「CHAPTER…」。
 * 与其替他挑一个新的死数，不如让他自己拖。右栏后来也照这个做。
 *
 * **只在宽屏用。** 窄屏那边两侧栏都是盖住正文的浮层，拖宽了只会遮更多。
 * 所以调用处传宽度时自己判断 `isWide`，这里不管布局。
 */
type Options = {
  /** 存在 localStorage 的哪个键下 */
  storageKey: string
  /** 没存过时用多宽 */
  initial: number
  /** 再窄就装不下里面的东西了 */
  min: number
  /** 再宽就开始吃正文了。实际还会再夹一道「不超过屏幕一半」 */
  max: number
  /** 杆在右侧栏的左边缘：往左拖才是变宽，位移要反过来算 */
  invert?: boolean
}

export function usePanelWidth({ storageKey, initial, min, max, invert = false }: Options) {
  const clamp = (px: number): number => {
    // 屏幕再小也不许一栏吃掉一半以上 —— 平板竖屏转横屏时这一夹很要紧
    const roomy = Math.min(max, Math.round(window.innerWidth * 0.5))
    return Math.max(min, Math.min(roomy, Math.round(px)))
  }

  const [width, setWidth] = useState<number>(() => {
    const saved = Number(localStorage.getItem(storageKey))
    return saved > 0 ? clamp(saved) : initial
  })
  const drag = useRef<{ startX: number; startWidth: number } | null>(null)
  const [dragging, setDragging] = useState(false)

  const widthAt = (clientX: number, from: { startX: number; startWidth: number }) =>
    clamp(from.startWidth + (invert ? from.startX - clientX : clientX - from.startX))

  /** 摊到那根杆的 div 上 */
  const handleProps = {
    onPointerDown: (e: React.PointerEvent) => {
      e.preventDefault()
      e.currentTarget.setPointerCapture(e.pointerId)
      drag.current = { startX: e.clientX, startWidth: width }
      setDragging(true)
    },
    onPointerMove: (e: React.PointerEvent) => {
      if (!drag.current) return
      setWidth(widthAt(e.clientX, drag.current))
    },
    onPointerUp: (e: React.PointerEvent) => {
      const from = drag.current
      if (!from) return
      drag.current = null
      setDragging(false)
      e.currentTarget.releasePointerCapture(e.pointerId)
      /*
       * 最终宽度**当场按这一下的位置算**，不要去读 width ——
       * 那是渲染时捕获的旧值，抬手和移动挨得近时 React 会把两次更新并成一批，
       * 存进去的就是拖之前的数（浏览器里当场抓到过）。
       * 松手才存：拖动过程中每一帧都写 localStorage 没必要。
       */
      const final = widthAt(e.clientX, from)
      setWidth(final)
      localStorage.setItem(storageKey, String(final))
    },
    onPointerCancel: () => {
      drag.current = null
      setDragging(false)
    }
  }

  return { width, dragging, handleProps }
}
