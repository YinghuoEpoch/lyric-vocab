import { useCallback, useRef, useState } from 'react'

/**
 * 左滑删除：**划到底就问一句，不留常驻的红按钮**。
 *
 * **两步才删**：划到位只是把「确定要删吗」问出来，还要在弹窗上再点一下才真删。
 * 这是用户拍板的，理由很硬 —— **笔记删了是真没了**，标注不进回收站
 * （回收站只管文档和文库），误滑一下，那条的音标、词性、释义一起没。
 *
 * 只在**单篇文档**的复习里开放。文库复习的一张卡是按拼写把好几条标注合并出来的
 * （同一个词在三篇里各标过一次，那儿只显示一条、频次记 3），
 * 滑掉它等于一次删好几条，而且看不见删了哪几条 —— 和拖拽排序在那边被禁掉同一个理由。
 *
 * ## 为什么不再是「滑开露出红按钮」
 *
 * 从前的做法是：一块红色**铺在卡片底下**，靠显示/隐藏控制，卡片用 transform 移开来露出它。
 * 用户接连报了三次毛病，一次比一次难缠：
 *
 * 1. 快速划回时红色**凭空消失** —— 卡片还在往回滑，红色已经不画了
 * 2. 让红色多留 180ms 之后，两块同样圆角的方块叠着，边角**透出一圈红边**
 * 3. 红层内收 1px 躲开红边、又把「快划时那 88px 被重演一遍」也修掉之后，**仍然闪**
 *
 * 第三次之后就该承认：**这是结构的问题，不是参数的问题。**
 * 红色的显隐走主线程绘制，卡片的位移走合成器，两条路只要差一帧，
 * 就会有「卡片还没归位、红色已经整块画出来」的那一帧。调时间只是在赌哪一帧。
 *
 * 现在整块红色没有了，也就没有任何东西需要「露出来又收回去」：
 * 手指划的时候卡片跟着走，松手一律弹回原位，划得够远就弹确认框。
 * 屏幕上自始至终只有一个会动的东西 —— 卡片自己。
 */

/** 先分清楚是横滑还是竖着滚页面，分清之前什么都不做 */
export const DIRECTION_SLOP = 8

/** 划过这么远（px），松手就问「确定要删吗」 */
export const TRIGGER_PX = 72

/** 手指最多能把卡片拉走这么远，再用力也不动了 */
export const MAX_PULL_PX = 96

/** 松手弹回原位要多久 */
export const SPRING_MS = 180

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

/**
 * 手指走了 dx，卡片实际挪多少。
 *
 * 往右拉不出头（卡片本来就在原位）。往左**过了触发线之后越拉越沉**：
 * 多出来的那一段只按三分之一算，到 MAX_PULL_PX 为止。
 * 这是这套做法里唯一的「已经划够了」的提示 —— 没有红色可看，只能靠手感：
 * 手指忽然变沉，就是划到位了。
 */
export function pullOffset(dx: number, trigger = TRIGGER_PX, max = MAX_PULL_PX): number {
  if (dx >= 0) return 0
  const pulled = -dx
  if (pulled <= trigger) return -pulled
  return -Math.min(max, trigger + (pulled - trigger) / 3)
}

/** 松手时划得够不够远 —— 够远就问一句 */
export function shouldAskDelete(offset: number, trigger = TRIGGER_PX): boolean {
  return -offset >= trigger
}

interface SwipeToDeleteProps {
  /** 划到位了：把「确定要删吗」问出来。真删与否由外面那个弹窗决定 */
  onRequestDelete: () => void
  children: React.ReactNode
}

export function SwipeToDelete({ onRequestDelete, children }: SwipeToDeleteProps) {
  const [dragOffset, setDragOffset] = useState<number | null>(null)
  /**
   * 手指现在拉到哪 —— **这一份才是准的**，state 那份只负责画出来。
   *
   * 松手时不能去读 state：浏览器会把好几个 pointermove 和 pointerup **合在同一帧**
   * 送来（快速一划就是这样），这时候 React 还没来得及重画，state 里还是上一帧的值，
   * 甚至还是初始的 null。照它判「滑够了没」，就会把一次利落的快划判成没滑够 ——
   * 手感上就是「划了没反应」，而慢慢拖却是好的。
   */
  const offsetRef = useRef(0)
  const start = useRef<{ x: number; y: number } | null>(null)
  /** null = 还没分清方向；true = 这一下归我们；false = 让给页面滚动 */
  const engaged = useRef<boolean | null>(null)
  /** 刚滑过，接下来那个 click 要吃掉，免得连带把卡片翻开 */
  const swiped = useRef(false)
  /** 跟着手指走的那一层。松手时要直接改它的 transform，见 finish */
  const moverRef = useRef<HTMLDivElement>(null)

  const offset = dragOffset ?? 0

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
    offsetRef.current = 0
  }, [])

  const onPointerMove = useCallback((e: React.PointerEvent) => {
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
    const next = pullOffset(dx)
    offsetRef.current = next
    setDragOffset(next)
  }, [])

  const finish = useCallback(() => {
    const wasEngaged = engaged.current === true
    const released = offsetRef.current

    /*
     * **先把 DOM 摆到手指真正松手的那个位置，再交给弹回的动画。**
     *
     * 快划一下的时候，浏览器把那几个 pointermove 和 pointerup **合在同一帧**送来，
     * React 一帧都没来得及画 —— 屏幕上那张卡还停在上一帧的位置，
     * 而下一次提交直接把它设成 0，还带着 180ms 的过渡，于是会凭空多演一段滑动。
     *
     * 这里手动把 transform 写成手指最后到的位置、把过渡临时关掉，再读一次
     * offsetWidth 逼浏览器认下这个新起点；随后 React 提交 0，弹回的动画就只走
     * 「真正还剩下的那一段」。
     *
     * ⚠️ **最后那两句得自己写回去，不能指望 React 来补。**
     * 一整串事件都在同一帧里，React 只提交一次渲染，而这一次和手势开始之前
     * 是同一份内容（都是「停在原位、带过渡」）—— 它认为什么都没变，
     * 于是一个字都不往 DOM 上写。上面临时写进去的 `none` 和那个位移就留在了元素上：
     * 卡片会**歪在半路不回来**。浏览器里当场撞见过一次，务必两句都补上。
     */
    const node = moverRef.current
    if (node && wasEngaged) {
      node.style.transition = 'none'
      node.style.transform = `translateX(${released}px)`
      void node.offsetWidth
      node.style.transition = `transform ${SPRING_MS}ms ease-out`
      node.style.transform = 'translateX(0px)'
    }

    start.current = null
    engaged.current = null
    offsetRef.current = 0
    setDragOffset(null)

    // 读 ref 不读 state，理由见 offsetRef 那段注释
    if (wasEngaged && shouldAskDelete(released)) onRequestDelete()
  }, [onRequestDelete])

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
      <div
        ref={moverRef}
        // pan-y：竖着滚交给浏览器自己处理，横向的才到我们手里。
        // 写 none 的话整张卡都滚不动了，列表会卡住
        style={{
          transform: `translateX(${offset}px)`,
          transition: dragOffset === null ? `transform ${SPRING_MS}ms ease-out` : 'none',
          touchAction: 'pan-y'
        }}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={finish}
        onPointerCancel={finish}
        onClickCapture={(e) => {
          // 刚滑完的那一下点击不算数，否则划一下就把答案翻开了
          if (swiped.current) {
            e.stopPropagation()
            swiped.current = false
          }
        }}
      >
        {children}
      </div>
    </div>
  )
}

