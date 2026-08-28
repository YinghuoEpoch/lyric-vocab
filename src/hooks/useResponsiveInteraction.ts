import { useCallback, useRef } from 'react'

interface ResponsiveInteractionOptions {
  /** 是否在移动端。推荐来自统一的 useIsMobile()，不要自己判定。 */
  isMobile: boolean
  /** 桌面端点击单词时触发（单击）。 */
  onDesktopClick: (e: React.MouseEvent, anchorId: string, word: string) => void
  /** 移动端双击单词时触发。 */
  onMobileDoubleTap: (anchorId: string, word: string) => void
  /** 移动端在已经存在选区时，单击单词触发（用于连词成句 / 修正范围）。 */
  onMobileTapAfterSelect?: (anchorId: string, word: string) => void
  /** 是否当前已经存在移动端选区（用于决定使用双击还是单击逻辑）。 */
  hasSelection?: boolean
  /** 移动端双击判定的时间窗口（毫秒），默认 300ms。 */
  doubleTapMs?: number
}

interface WordHandlers {
  onClick?: (e: React.MouseEvent) => void
  onTouchEnd?: (e: React.TouchEvent) => void
}

interface ResponsiveInteractionResult {
  /** 根据 anchorId / word 生成对应的事件处理器集合，组件内部无需再写 if(isMobile)。 */
  getWordHandlers: (anchorId: string, word: string) => WordHandlers
  /** 给 UI 展示的提示文案（如“点击单词添加笔记”/“双击单词添加笔记”）。 */
  interactionHint: string
}

export function useResponsiveInteraction({
  isMobile,
  onDesktopClick,
  onMobileDoubleTap,
  onMobileTapAfterSelect,
  hasSelection = false,
  doubleTapMs = 300
}: ResponsiveInteractionOptions): ResponsiveInteractionResult {
  const lastTapRef = useRef<{ anchorId: string; timestamp: number } | null>(null)

  const getWordHandlers = useCallback(
    (anchorId: string, word: string): WordHandlers => {
      if (isMobile) {
        // 若已存在选区，则移动端单击用于「连词成句 / 修正范围」，不再做双击判定
        if (hasSelection && onMobileTapAfterSelect) {
          return {
            onTouchEnd: (e: React.TouchEvent) => {
              e.preventDefault()
              onMobileTapAfterSelect(anchorId, word)
            }
          }
        }

        // 默认：使用双击判定打开单词笔记
        return {
          onTouchEnd: (e: React.TouchEvent) => {
            const now = Date.now()
            const prev = lastTapRef.current
            if (prev && prev.anchorId === anchorId && now - prev.timestamp <= doubleTapMs) {
              // 判定为双击：拦截默认行为并触发移动端查词
              e.preventDefault()
              lastTapRef.current = null
              onMobileDoubleTap(anchorId, word)
              return
            }
            // 记录本次 tap，为下一次判定做准备
            lastTapRef.current = { anchorId, timestamp: now }
          }
        }
      }

      // 桌面端：简单的单击触发
      return {
        onClick: (e: React.MouseEvent) => {
          onDesktopClick(e, anchorId, word)
        }
      }
    },
    [isMobile, doubleTapMs, onDesktopClick, onMobileDoubleTap, hasSelection, onMobileTapAfterSelect]
  )

  const interactionHint = isMobile ? '阅读模式 · 双击单词添加笔记' : '阅读模式 · 点击单词添加笔记'

  return { getWordHandlers, interactionHint }
}

