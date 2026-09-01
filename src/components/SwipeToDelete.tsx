import { useCallback, useRef, useState } from 'react'
import { Trash2 } from 'lucide-react'

/**
 * 左滑露出「删除」。
 *
 * **两步才删**：滑开只是把按钮露出来，还要再点一下才真删。
 * 这是用户拍板的，理由很硬 —— **笔记删了是真没了**，标注不进回收站
 * （回收站只管文档和文库），误滑一下，那条的音标、词性、释义一起没。
 *
 * 只在**单篇文档**的复习里开放。文库复习的一张卡是按拼写把好几条标注合并出来的
 * （同一个词在三篇里各标过一次，那儿只显示一条、频次记 3），
 * 滑掉它等于一次删好几条，而且看不见删了哪几条 —— 和拖拽排序在那边被禁掉同一个理由。
 */

/** 露出来的删除区有多宽 */
export const REVEAL_PX = 88

/** 先分清楚是横滑还是竖着滚页面，分清之前什么都不做 */
export const DIRECTION_SLOP = 8

/**
 * 这一下算不算「横向滑动」。
 *
 * 卡片是竖着排的一长列，手指多半是想滚页面。**横向位移既要够大、
 * 又要比纵向大**，两条都满足才接管；否则一路让给浏览器自己滚，
 * 不然列表会变得很难往下划。
 */
export function isHorizontalSwipe(dx: number, dy: number, slop = DIRECTION_SLOP): boolean {
  return Math.abs(dx) > slop && Math.abs(dx) > Math.abs(dy)
}

/** 松手之后停在哪：拉过一半就当要开着 */
export function shouldStayOpen(offset: number, reveal = REVEAL_PX): boolean {
  return -offset > reveal / 2
}

/** 把位移夹在 0 到 -REVEAL 之间 —— 往右拉不出头，往左也不无限拉 */
export function clampOffset(raw: number, reveal = REVEAL_PX): number {
  return Math.max(-reveal, Math.min(0, raw))
}

interface SwipeToDeleteProps {
  /** 关掉的时候传 false；由外面统一管，保证同时只开一张 */
  open: boolean
  onOpenChange: (open: boolean) => void
  onDelete: () => void
  /** 删除按钮的无障碍说明，例如「删除 stumble 这条笔记」 */
  deleteLabel: string
  children: React.ReactNode
}

export function SwipeToDelete({
  open,
  onOpenChange,
  onDelete,
  deleteLabel,
  children
}: SwipeToDeleteProps) {
  const [dragOffset, setDragOffset] = useState<number | null>(null)
  /**
   * 手指现在拉到哪 —— **这一份才是准的**，state 那份只负责画出来。
   *
   * 松手时不能去读 state：浏览器会把好几个 pointermove 和 pointerup **合在同一帧**
   * 送来（快速一划就是这样），这时候 React 还没来得及重画，state 里还是上一帧的值，
   * 甚至还是初始的 null。照它判「滑够了没」，就会把一次利落的快划判成没滑够、
   * 又弹回去 —— 手感上就是「划了没反应」，而慢慢拖却是好的。
   */
  const offsetRef = useRef(0)
  const start = useRef<{ x: number; y: number } | null>(null)
  /** null = 还没分清方向；true = 这一下归我们；false = 让给页面滚动 */
  const engaged = useRef<boolean | null>(null)
  /** 刚滑过，接下来那个 click 要吃掉，免得连带把卡片展开 */
  const swiped = useRef(false)

  const offset = dragOffset ?? (open ? -REVEAL_PX : 0)

  const onPointerDown = useCallback((e: React.PointerEvent) => {
    // 手柄、朗读按钮、编辑模式下的输入框都不能被滑动抢走
    if ((e.target as HTMLElement).closest('button, input, textarea, select, a')) return
    start.current = { x: e.clientX, y: e.clientY }
    engaged.current = null
    swiped.current = false
    offsetRef.current = open ? -REVEAL_PX : 0
  }, [open])

  const onPointerMove = useCallback(
    (e: React.PointerEvent) => {
      if (!start.current || engaged.current === false) return
      const dx = e.clientX - start.current.x
      const dy = e.clientY - start.current.y

      if (engaged.current === null) {
        // 纵向先跑出去了：这是在滚页面，撒手
        if (Math.abs(dy) > DIRECTION_SLOP && Math.abs(dy) >= Math.abs(dx)) {
          engaged.current = false
          return
        }
        if (!isHorizontalSwipe(dx, dy)) return
        engaged.current = true
        // 有的浏览器对「不是当前活动指针」的 id 会直接抛错，抓住就好，
        // 捕获不到顶多是手指划出卡片外时跟丢，不该让整个手势崩掉
        try {
          e.currentTarget.setPointerCapture?.(e.pointerId)
        } catch {
          /* 捕获不到就算了 */
        }
      }

      swiped.current = true
      const next = clampOffset((open ? -REVEAL_PX : 0) + dx)
      offsetRef.current = next
      setDragOffset(next)
    },
    [open]
  )

  const finish = useCallback(() => {
    // 读 ref 不读 state，理由见 offsetRef 那段注释
    if (engaged.current === true) onOpenChange(shouldStayOpen(offsetRef.current))
    start.current = null
    engaged.current = null
    setDragOffset(null)
  }, [onOpenChange])

  return (
    <div className="relative overflow-hidden rounded-xl">
      {/* 删除区躺在卡片底下，卡片滑开才露出来 */}
      <div className="absolute inset-y-0 right-0 flex" style={{ width: REVEAL_PX }}>
        <button
          type="button"
          onClick={onDelete}
          aria-label={deleteLabel}
          className="flex-1 flex flex-col items-center justify-center gap-1 bg-red-500 text-white text-xs font-medium active:bg-red-600"
        >
          <Trash2 className="w-4 h-4" />
          删除
        </button>
      </div>

      <div
        // pan-y：竖着滚交给浏览器自己处理，横向的才到我们手里。
        // 写 none 的话整张卡都滚不动了，列表会卡住
        style={{
          transform: `translateX(${offset}px)`,
          transition: dragOffset === null ? 'transform 180ms ease-out' : 'none',
          touchAction: 'pan-y'
        }}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={finish}
        onPointerCancel={finish}
        onClickCapture={(e) => {
          // 刚滑完的那一下点击不算数；已经滑开时，点卡片本体是「收回去」
          if (swiped.current) {
            e.stopPropagation()
            swiped.current = false
            return
          }
          if (open) {
            e.stopPropagation()
            onOpenChange(false)
          }
        }}
      >
        {children}
      </div>
    </div>
  )
}
