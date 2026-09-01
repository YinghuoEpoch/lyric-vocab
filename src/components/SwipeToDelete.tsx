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
    const target = e.target as HTMLElement

    /*
     * 只挡两种，别再多挡了。
     *
     * **第一版把 button / input / textarea 全挡掉，结果真机上「划了一点反应都没有」。**
     * 编辑模式下卡片正中间那条带子全是输入框（音标、释义、词性）加朗读按钮 ——
     * 量过：卡片上 15 个探测点有 9 个落在这些元素上，手指自然按下去几乎必然被挡。
     *
     * 浏览器里没发现，是因为当时把事件直接打在卡片外层的 div 上，绕开了所有子元素。
     * **测手势要打在手指真正会碰到的那个元素上。**
     */

    // 1. 拖拽手柄有自己的手势（dnd-kit + touch-action: none），不能两边抢
    if (target.closest('[data-no-swipe]')) return

    // 2. 正在编辑的那一格：横着拖是在挪光标 / 选字，不是要划卡片。
    //    没聚焦的格子照样能划 —— 那时候横拖没有别的含义
    const field = target.closest('input, textarea')
    if (field && document.activeElement === field) return

    // 按钮不挡：只有走够 8px 才会接管，点一下照样是点一下
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

  /** 静止收着的时候根本不画红色那层 —— 画了也只会从圆角缝里透出来 */
  const revealing = open || dragOffset !== null

  return (
    /*
     * **手机上不裁，宽屏上裁。**
     *
     * 卡片往左滑时，`overflow-hidden` 是在**卡片自己的边界**上裁的 ——
     * 看起来像卡片左边被一口口啃掉，而不是滑出去。手机上是单列，
     * 让它滑出去就好，外面那层容器自然会在屏幕边缘裁断，那才是「被推出去」的样子。
     *
     * 宽屏（sm 起）一行有 2～4 张卡，不裁的话滑动的这张会盖到左边邻居身上，
     * 所以那边仍旧裁。
     */
    <div className="relative overflow-visible sm:overflow-hidden rounded-xl">
      {/*
        红色这层**铺满整张卡底下**，不是只占右边那 88px。

        只占右边的话，卡片滑开时它的**圆角**会在接缝处露出一弯底色 ——
        卡片是 rounded-xl，右边缘是弧的，而红块的左边是直的，两者贴不上。
        铺满就没有接缝可言：卡片让开多少，露出来的就是多少红色。

        自己带 `rounded-xl`，不靠外层去裁 —— 手机上外层是不裁的（见上面）。

        **静止时干脆不画。** 两个同样大小、同样圆角的方块叠在一起，
        边角上总会因为抗锯齿透出一丝红边（用户报的「边角没被盖全」就是它）。
        与其去凑那一个像素，不如没在滑的时候根本不画。
      */}
      <div className={`absolute inset-0 flex justify-end rounded-xl bg-red-500 ${revealing ? '' : 'hidden'}`}>
        <button
          type="button"
          onClick={onDelete}
          aria-label={deleteLabel}
          style={{ width: REVEAL_PX }}
          className="flex flex-col items-center justify-center gap-1 text-white text-xs font-medium active:bg-red-600"
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
