import { useCallback, useEffect, useRef, useState } from 'react'
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
 * 卡片滑回原位要多久。**样式里的过渡时长和这里必须是同一个数**，
 * 所以只写这一处，下面的 transition 直接引它。
 */
export const CLOSE_MS = 180

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
  /** 会跟着手指走的那一层，松手时要直接改它的 transform，见 finish */
  const moverRef = useRef<HTMLDivElement>(null)

  const offset = dragOffset ?? (open ? -REVEAL_PX : 0)

  /** 手指或 open 状态说「现在是露着的」 */
  const revealing = open || dragOffset !== null

  /**
   * 收回去的那 180ms 里，红色那层要继续画着。
   *
   * 从前只看 revealing：一松手它立刻变 false，红色**当场消失**，而卡片才刚开始
   * 往回滑 —— 于是有近 0.2 秒，卡片是压着一片空白往回走的。
   * 慢慢拖回去看不出来（松手时缺口已经很小），快划一下甩手就很扎眼，
   * 用户报的「红色按钮凭空不见了」就是它。
   *
   * 配套还得让红层比卡片**小一圈**，否则会换来另一个毛病 —— 见下面 inset-[1px]。
   */
  const [closing, setClosing] = useState(false)
  const wasRevealing = useRef(false)
  useEffect(() => {
    const was = wasRevealing.current
    wasRevealing.current = revealing
    if (!was || revealing) return
    setClosing(true)
    const timer = window.setTimeout(() => setClosing(false), CLOSE_MS)
    return () => window.clearTimeout(timer)
  }, [revealing])

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
    /*
     * **先把 DOM 摆到手指真正松手的那个位置，再交给过渡。**
     *
     * 快划一下的时候，浏览器把那几个 pointermove 和 pointerup **合在同一帧**送来，
     * React 一帧都没来得及画 —— 屏幕上那张卡还停在 -88px（划开时的位置），
     * 而下一次提交直接把它设成 0，还带着 180ms 的过渡。
     * 结果就是：手指明明已经把卡片推回去了，松手后它又**从头演一遍那 88px**，
     * 红色删除区跟着整块露出来再被抹掉 —— 用户报的「快速往回划红色会闪一下」就是它。
     * （用 getAnimations() 抓到过：松手后生成的过渡是从一个很靠左的位置滑到 0，180ms。）
     *
     * 这里手动把 transform 写成手指最后到的位置、并把过渡临时关掉，再读一次
     * offsetWidth 逼浏览器认下这个新起点。随后 React 提交最终位置时，
     * 过渡只需要走「真正还剩下的那一小段」—— 手指已经推到位就等于不用动。
     * 中途松手（比如只推回一半）不受影响，那时候确实还剩一段，红色也该露着。
     */
    const node = moverRef.current
    if (node && engaged.current === true) {
      node.style.transition = 'none'
      node.style.transform = `translateX(${offsetRef.current}px)`
      // 读一下强制结算，下一次改 transform 才是从这个位置开始动
      void node.offsetWidth
      /*
       * **过渡必须自己恢复回去，不能指望 React 来补。**
       * 快划时那一整串事件在同一帧里，React 只会提交一次渲染，
       * 它记着的上一次 transition 和这一次是同一个字符串，于是根本不去动 DOM ——
       * 上面那句 `none` 就永远留在了元素上，从此再也不会有滑动动画。
       * 这里写回去的字符串和渲染里那句必须一模一样。
       */
      node.style.transition = `transform ${CLOSE_MS}ms ease-out`
    }

    // 读 ref 不读 state，理由见 offsetRef 那段注释
    if (engaged.current === true) onOpenChange(shouldStayOpen(offsetRef.current))
    start.current = null
    engaged.current = null
    setDragOffset(null)
  }, [onOpenChange])

  /** 真正要不要画红色那层：露着的时候画，收回去的动画走完才停 */
  const paintRed = revealing || closing

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

        **比卡片各边小 1px（inset-[1px]）。** 两块一样大、一样圆角的方块叠在一起，
        边角上总会因为抗锯齿透出一丝红边 —— 从前是靠「静止时根本不画」躲开的，
        但那样一来卡片滑回去的过程中红色就没了（用户报的「红色凭空消失」）。
        改成留着画之后，那圈红边就在收回去的 180ms 里露了出来，
        看着是卡片边缘**闪一下红**（用户报的第二个毛病）。

        往里收 1px 就没这回事了：小一圈的圆角整个落在卡片圆角**里面**
        （45° 方向上差着 1.4px），怎么叠都盖得住。
        露出来的那 88px 红区跟着少 1px，肉眼看不出来。
      */}
      <div className={`absolute inset-[1px] flex justify-end rounded-xl bg-red-500 ${paintRed ? '' : 'hidden'}`}>
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
        ref={moverRef}
        // pan-y：竖着滚交给浏览器自己处理，横向的才到我们手里。
        // 写 none 的话整张卡都滚不动了，列表会卡住
        style={{
          transform: `translateX(${offset}px)`,
          transition: dragOffset === null ? `transform ${CLOSE_MS}ms ease-out` : 'none',
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
