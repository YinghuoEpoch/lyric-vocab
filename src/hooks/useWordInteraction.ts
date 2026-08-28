import { useCallback, useEffect, useRef, useState } from 'react'

/** 长按判定时长：超过这个时间不松手，就认为是「要标这个词」 */
const LONG_PRESS_MS = 450
/** 手指允许的移动范围：超过就认为用户在滚动页面，取消长按 */
const MOVE_TOLERANCE_PX = 10

interface WordInteractionOptions {
  /** 当前没有选中任何词时，长按某个词：开始一次标记 */
  onLongPress: (anchorId: string, word: string) => void
  /** 当前已有选中时，轻点某个词：连词成句 / 修正范围 / 取消选中 */
  onTapWithSelection: (anchorId: string, word: string) => void
  /** 当前是否已有选中 */
  hasSelection: boolean
  longPressMs?: number
}

interface WordHandlers {
  onPointerDown: (e: React.PointerEvent) => void
  onPointerUp: (e: React.PointerEvent) => void
  onPointerMove: (e: React.PointerEvent) => void
  onPointerCancel: () => void
  onContextMenu: (e: React.SyntheticEvent) => void
}

interface WordInteractionResult {
  /** 生成某个单词的事件处理器 */
  getWordHandlers: (anchorId: string, word: string) => WordHandlers
  /** 当前正被按住的单词（用于显示按压反馈，让用户知道「按住有用」） */
  pressingAnchorId: string | null
  /** 顶栏提示文案 */
  interactionHint: string
}

/**
 * 单词的触摸交互。
 *
 * 设计成「长按取词」而不是「双击取词」，原因：
 * - 双击要靠自己掐 300ms 的表来判定，而这段时间里浏览器自己也在处理双击缩放、
 *   文字选择、点击延迟，三方抢同一个手势，结果就是时灵时不灵。
 * - 长按是移动端「对这段文字做点什么」的标准手势，不和上述任何行为冲突，
 *   而且手指一移动就能干净地退出（判定为滚动页面）。
 *
 * 用 Pointer 事件而非 Touch 事件，这样鼠标按住不放也能触发，方便在电脑浏览器里调试。
 */
export function useWordInteraction({
  onLongPress,
  onTapWithSelection,
  hasSelection,
  longPressMs = LONG_PRESS_MS
}: WordInteractionOptions): WordInteractionResult {
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const startPosRef = useRef<{ x: number; y: number } | null>(null)
  /** 本次按压是否已经触发过长按（触发过就不再当作轻点处理） */
  const firedRef = useRef(false)
  const [pressingAnchorId, setPressingAnchorId] = useState<string | null>(null)

  const cancelPress = useCallback(() => {
    if (timerRef.current) {
      clearTimeout(timerRef.current)
      timerRef.current = null
    }
    startPosRef.current = null
    setPressingAnchorId(null)
  }, [])

  // 组件卸载时清掉未完成的计时器
  useEffect(() => cancelPress, [cancelPress])

  const getWordHandlers = useCallback(
    (anchorId: string, word: string): WordHandlers => ({
      onPointerDown: (e: React.PointerEvent) => {
        // 只响应主键（触摸和左键）
        if (e.button !== 0) return
        firedRef.current = false
        startPosRef.current = { x: e.clientX, y: e.clientY }
        setPressingAnchorId(anchorId)

        if (timerRef.current) clearTimeout(timerRef.current)
        timerRef.current = setTimeout(() => {
          timerRef.current = null
          firedRef.current = true
          setPressingAnchorId(null)
          onLongPress(anchorId, word)
        }, longPressMs)
      },

      onPointerMove: (e: React.PointerEvent) => {
        const start = startPosRef.current
        if (!start) return
        const dx = e.clientX - start.x
        const dy = e.clientY - start.y
        // 手指移动超过容差 = 用户在滚动，不是在按住这个词
        if (Math.hypot(dx, dy) > MOVE_TOLERANCE_PX) cancelPress()
      },

      onPointerUp: () => {
        const wasLongPress = firedRef.current
        cancelPress()
        firedRef.current = false
        // 长按已经处理过了，松手不再重复触发
        if (wasLongPress) return
        // 轻点只在「已经有选中」时有意义：用来连词成句或修正范围。
        // 没有选中时的轻点保持无反应，避免正常阅读时误触。
        if (hasSelection) onTapWithSelection(anchorId, word)
      },

      onPointerCancel: cancelPress,

      // 长按时浏览器默认会弹出「复制 / 选择」菜单，这里挡掉
      onContextMenu: (e: React.SyntheticEvent) => e.preventDefault()
    }),
    [hasSelection, longPressMs, onLongPress, onTapWithSelection, cancelPress]
  )

  const interactionHint = hasSelection
    ? '轻点其它单词可连成句子 · 再点一次取消'
    : '阅读模式 · 长按单词添加笔记'

  return { getWordHandlers, pressingAnchorId, interactionHint }
}
