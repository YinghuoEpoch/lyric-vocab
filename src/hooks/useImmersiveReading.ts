import { useCallback, useEffect, useRef, useState } from 'react'
import { setSystemBarsHidden } from '../safeArea'

/** 顶栏和「笔记」键露出来之后，多久自己收回去 */
export const CHROME_AUTO_HIDE_MS = 3000

/** 进不进沉浸，要看的几件事 */
export interface ImmersiveConditions {
  /** 够不够宽（1024 起）。宽窄两套的**触发方式**不一样，见 shouldImmerse */
  isWide: boolean
  /** 阅读还是复习 */
  mode: 'read' | 'review'
  /** 是不是正在编辑全文 */
  editMode: boolean
  /** 左边那栏收起来了没有（只在宽屏下有意义） */
  leftHidden: boolean
  /** 有没有哪一侧栏开着（宽屏是笔记栏，窄屏是浮层，两种都算） */
  panelOpen: boolean
  /** 窄屏那个手动开关此刻是开着的吗（宽屏不看这一格） */
  narrowOn: boolean
}

/**
 * 该不该进沉浸。
 *
 * 抽成纯函数是为了能单独测：真机上的表现（系统栏、真实手感）我验不了，
 * 但「什么时候该进、什么时候一定不能进」是可以钉死的。
 *
 * ## 宽窄两套触发方式，是用户分两次定的
 *
 * - **宽屏（平板横屏）**：自动。两侧栏都收起来就进；点空白处顶栏露 3 秒又自己收。
 *   那种时候屏幕够大，侧栏收起来本身就说明「我要安静读书」。
 * - **窄屏（手机、平板竖屏）**：手动。点一下空白处收起顶栏，**不会自己回来**，
 *   再点一下才回来。窄屏上侧栏本来就总是收着的，拿它当信号会变成一直沉浸；
 *   而且手机上顶栏是唯一的出口（侧栏、笔记都从那儿开），不能让它自作主张地消失。
 *
 * 三条共同的否决项是「这时候你需要那些按钮」：复习模式要编辑键、编辑全文要工具栏、
 * 侧栏开着说明用户正在用界面。弹窗不必单列 —— 设置在左栏里、AI 那几个从右栏开，
 * 开着的时候必有一侧栏是放出来的。
 */
export function shouldImmerse(c: ImmersiveConditions): boolean {
  if (c.mode !== 'read') return false
  if (c.editMode) return false
  if (c.panelOpen) return false
  return c.isWide ? c.leftHidden : c.narrowOn
}

export interface ImmersiveReading {
  /** 此刻是不是沉浸态（系统栏已经藏起来了） */
  immersive: boolean
  /** 沉浸态下，顶栏和「笔记」键这会儿露没露出来 */
  chromeVisible: boolean
  /** 点了正文空白处：没露就露出来（3 秒后自己收），已经露着就立刻收回去 */
  toggleChrome: () => void
}

/**
 * 沉浸阅读。
 *
 * 像看视频一样只剩正文：app 的顶栏（两条带）、安卓的两条系统栏、
 * 右边那颗「笔记」键（宽屏才有）一起收掉。
 *
 * 什么时候进由外面算好了传进来（见 shouldImmerse，宽窄两套触发方式）。
 * 这里只管进去之后的事：系统栏的开关、顶栏那一套的出没和那块表。
 * **窄屏没有表** —— 那边收起来就一直收着，chromeVisible 永远是 false，
 * 下面那个计时器自然也不会起来。
 *
 * **状态栏、顶栏、「笔记」键三样绑成一体**：点正文空白处一起出来，3 秒后一起收，
 * 再点一下立刻收。这是第二版定下的 —— 第一版只有顶栏和「笔记」键跟着走，
 * 系统栏另有一套作息，于是同一条顶栏在两种形态下厚度不一样，
 * 退出沉浸时还分两段长出来。缘由见下面那个开关的注释，以及 safeArea.ts 的 --sa-top-real。
 *
 * 顶栏和「笔记」键必须绑在一起，还有个硬理由：汉堡键长在顶栏里 ——
 * 顶栏不跟着出来，沉浸之后就没路再打开文库了。
 *
 * 系统栏藏起来之后，从屏幕顶端往下滑还能临时把它叫出来、过会儿自己收，
 * 那一套是安卓自带的（见 SafeAreaPlugin.setImmersive），这里不掐那块表。
 */
export function useImmersiveReading(immersive: boolean): ImmersiveReading {
  const [chromeVisible, setChromeVisible] = useState(false)
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  const clearTimer = useCallback(() => {
    if (timerRef.current) {
      clearTimeout(timerRef.current)
      timerRef.current = null
    }
  }, [])

  /* 进出沉浸：把顶栏那一套收回初始状态 */
  useEffect(() => {
    setChromeVisible(false)
    clearTimer()
  }, [immersive, clearTimer])

  /*
   * **系统栏跟着顶栏一起出没**，不是跟着「沉不沉浸」走。
   *
   * 三样绑成一体（状态栏 / 顶栏 / 「笔记」键）是用户定的，起因是两种形态跨度太大：
   * 从前沉浸里点出来的顶栏贴着屏幕最顶上（84px），正常模式下同一条顶栏上面还顶着
   * 状态栏（108px）—— 同一条栏两种厚度。而且退出沉浸时这两截是**分两次**长出来的：
   * 网页那一步是瞬间的，状态栏那一步要等安卓滑完动画再报尺寸。
   *
   * 现在露出顶栏就把状态栏一起放出来，且顶栏按 `--sa-top-real`（状态栏**本来**多高，
   * 见 safeArea.ts）预先留好它的位置 —— 两种形态从此一样厚，退出沉浸也没有第二段了。
   */
  useEffect(() => {
    void setSystemBarsHidden(immersive && !chromeVisible)
  }, [immersive, chromeVisible])

  /*
   * 兜底：整个组件没了也要把系统栏放回来。
   *
   * 少了这一句，万一在沉浸态下被卸载（切页面、热更新），
   * 系统栏就再也回不来了 —— 那是个只能杀进程才能退出的死角。
   */
  useEffect(() => {
    return () => {
      clearTimer()
      void setSystemBarsHidden(false)
    }
  }, [clearTimer])

  /*
   * 从后台回来时再交代一次。
   *
   * 切出去再切回来，系统很可能已经把两条栏放回来了，而网页这边的状态没变过 ——
   * 不补这一句，回来就成了「以为自己还沉浸着，其实栏都在」。
   * 只在沉浸态下听，退出沉浸时这个监听就摘掉了。
   */
  useEffect(() => {
    if (!immersive) return
    const onVisible = () => {
      if (!document.hidden) void setSystemBarsHidden(!chromeVisible)
    }
    document.addEventListener('visibilitychange', onVisible)
    return () => document.removeEventListener('visibilitychange', onVisible)
  }, [immersive, chromeVisible])

  /* 露出来之后开始倒计时。chromeVisible 每翻一次都重排一次表 */
  useEffect(() => {
    clearTimer()
    if (!immersive || !chromeVisible) return
    timerRef.current = setTimeout(() => {
      setChromeVisible(false)
      timerRef.current = null
    }, CHROME_AUTO_HIDE_MS)
    return clearTimer
  }, [immersive, chromeVisible, clearTimer])

  const toggleChrome = useCallback(() => {
    setChromeVisible((v) => !v)
  }, [])

  return { immersive, chromeVisible, toggleChrome }
}
