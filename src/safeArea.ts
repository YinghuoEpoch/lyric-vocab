import { Capacitor, registerPlugin } from '@capacitor/core'

/**
 * 系统栏安全区：四条边各要让出多少。
 *
 * app 是沉浸式的（网页铺到状态栏和导航栏底下，见 android 那边的 MainActivity），
 * 所以留白得自己算。这里只负责**把四个数算出来写成 CSS 变量**，
 * 谁用这几个变量、留白加在哪一层，全在样式那边（src/index.css 的说明）。
 *
 * 两条取值的路，先后顺序是死的：
 *
 * 1. **启动时网页主动问原生要**（SafeArea 插件）。上一版是原生往网页里塞，
 *    和页面加载抢跑，真机上四个值全是 0 —— 问答式抢不了跑，这次换成它。
 * 2. **之后的变化由原生推**（转屏、键盘），走下面那个 `__onNativeInsets` 钩子。
 *    那时候网页早在了，不存在抢跑。
 *
 * 两条路都没到值时还有兜底：CSS 里 `.native` 给顶部垫了 24px（见 index.css），
 * 最坏也就是留白略窄，不会变成正文压在时钟底下。
 */

/** 顶部保底：万一两条路都没报上来值，也不能让正文顶到时钟上去。状态栏本来就是 24dp 上下 */
const MIN_TOP = 24

/**
 * 打包时刻（vite.config.ts 里 define 进来的）。
 *
 * ⚠️ **必须带兜底。** 改了 vite.config 开发服务器不会自动生效、得重启，
 * 而没重启时这个名字压根不存在 —— 直接引用会抛 ReferenceError，
 * 在模块顶层抛就是整个 app 白屏。栽过一次：一个只用来显示的时间戳，
 * 不该有把界面弄没的能力。
 */
const BUILD_STAMP = typeof __BUILD_STAMP__ === 'undefined' ? '开发中' : __BUILD_STAMP__

type NativeInsets = {
  available?: boolean
  top?: number
  right?: number
  bottom?: number
  left?: number
  /** 放按钮要往上让多少。手势条是 0，三颗导航键才是整条 —— 缘由见 SafeAreaPlugin */
  tappableBottom?: number
  /** tappableElement 原样报的数 —— 和上面那个不一样时，说明这台 ROM 报得不对 */
  tappableRaw?: number
  /** 0 = 三颗键，1 = 两颗键，2 = 手势，-1 = 读不到 */
  navMode?: number
  sdk?: number
  density?: number
}

const SafeArea = registerPlugin<{
  getInsets(): Promise<NativeInsets>
  setImmersive(options: { on: boolean }): Promise<void>
}>('SafeArea')

/**
 * 沉浸阅读：把两条系统栏藏起来 / 放回来。
 *
 * 只在装成 app 时有意义，浏览器里是空转（网页没权力动浏览器的界面）。
 * **调用方要保证只在宽屏时开** —— 这是手机平板共用的地基，见 SafeAreaPlugin 里的说明。
 *
 * 失败了就当没发生：藏不藏系统栏不影响读书，为它弹个错误提示反而碍事。
 */
export async function setSystemBarsHidden(hidden: boolean): Promise<void> {
  if (!Capacitor.isNativePlatform()) return
  try {
    await SafeArea.setImmersive({ on: hidden })
  } catch {
    /* 老包里没有这个方法，或者这台机器不认 —— 都不该拦着人读书 */
  }
}

/** 这次到底走的哪条路、拿到了什么。设置页「开发者 → 系统栏参数」那一屏显示它 */
export type SafeAreaReport = {
  source: '原生·问答' | '原生·推送' | 'env()' | '没拿到（用保底）'
  top: number
  right: number
  bottom: number
  left: number
  tappableBottom?: number
  tappableRaw?: number
  navMode?: number
  /** 输入法此刻有多高（0 = 没弹出来） */
  keyboard?: number
  sdk?: number
  density?: number
  error?: string
  /** 这份网页是什么时候打的 —— 用来确认手机上跑的不是上一版（这个 app 栽过一次） */
  build: string
}

let report: SafeAreaReport = {
  source: 'env()',
  top: 0,
  right: 0,
  bottom: 0,
  left: 0,
  build: BUILD_STAMP
}

/** 读一眼这次的取值情况。给设置页里「开发者 → 系统栏参数」那一屏用 */
export function getSafeAreaReport(): SafeAreaReport {
  return report
}

/** 浏览器里量一下 env() 实际给了多少 —— 只在没拿到原生值时用得着 */
function readEnvInsets(): { top: number; right: number; bottom: number; left: number } {
  const probe = document.createElement('div')
  probe.style.cssText = [
    'position:fixed',
    'left:0',
    'top:0',
    'visibility:hidden',
    'pointer-events:none',
    'padding-top:env(safe-area-inset-top,0px)',
    'padding-right:env(safe-area-inset-right,0px)',
    'padding-bottom:env(safe-area-inset-bottom,0px)',
    'padding-left:env(safe-area-inset-left,0px)'
  ].join(';')
  document.body.appendChild(probe)
  const cs = getComputedStyle(probe)
  const px = (v: string) => Math.round(parseFloat(v) || 0)
  const out = {
    top: px(cs.paddingTop),
    right: px(cs.paddingRight),
    bottom: px(cs.paddingBottom),
    left: px(cs.paddingLeft)
  }
  probe.remove()
  return out
}

/**
 * 把数写成 CSS 变量。
 *
 * 顶部套一道保底，其余不套 —— 左右只有横过来吃到刘海时才不是 0。
 *
 * **底边有两个数，别混用**：
 *
 * - `--sa-bottom`：底下那条系统栏有多高。滚动到底时让内容能滚过它，
 *   免得最后一行卡在导航键底下看不全
 * - `--sa-bottom-tap`：**放按钮要往上让多少**。手势条是 0（那条是透的、点得穿），
 *   三颗导航键才是整条。侧栏底部那排图标用它 ——
 *   一律按前者让的话，手势条的机器上会白留一条，看着像整栏被抬了起来
 */
function apply(
  top: number,
  right: number,
  bottom: number,
  left: number,
  tappableBottom: number,
  keyboard = 0
) {
  const s = document.documentElement.style
  s.setProperty('--sa-top', `${Math.max(top, MIN_TOP)}px`)
  s.setProperty('--sa-right', `${right}px`)
  s.setProperty('--sa-bottom', `${bottom}px`)
  s.setProperty('--sa-bottom-tap', `${tappableBottom}px`)
  s.setProperty('--sa-left', `${left}px`)
  // 输入法有多高。从前是原生把整个窗口往上挤，三栏一起变矮；现在只报数，谁让谁自己让
  s.setProperty('--kb', `${keyboard}px`)
  // 有些位置是 JS 算的（长按取词那个小窗），光有 CSS 变量它看不见
  setKeyboard(keyboard)
}

/**
 * 键盘高度的订阅。
 *
 * CSS 变量改了不会通知 JS，而「长按取词那个小窗要不要躲开键盘」是 JS 在算位置，
 * 所以这里留一条订阅：值一变就叫一声。见 hooks/useKeyboardHeight.ts。
 */
type KeyboardListener = (px: number) => void
const keyboardListeners = new Set<KeyboardListener>()
let currentKeyboard = 0

export function onKeyboardChange(fn: KeyboardListener): () => void {
  keyboardListeners.add(fn)
  fn(currentKeyboard)
  return () => {
    keyboardListeners.delete(fn)
  }
}

function setKeyboard(px: number) {
  if (px === currentKeyboard) return
  currentKeyboard = px
  keyboardListeners.forEach((fn) => fn(px))
}

declare global {
  interface Window {
    /** 原生在转屏、键盘弹起收起之后调这个（见 MainActivity 的 pushInsets） */
    __onNativeInsets?: (
      top: number,
      right: number,
      bottom: number,
      left: number,
      tappableBottom: number,
      keyboard: number
    ) => void
  }
}

/**
 * 启动时调一次。**必须在 React 渲染之前**，否则第一帧会按 0 留白，看得见一跳。
 *
 * 拿不到值不抛错也不卡着：外面那层有超时（见 main.tsx），
 * 最坏就是走 CSS 里的保底，界面照常出来。
 */
export async function initSafeArea(): Promise<void> {
  /*
   * 这个钩子**在浏览器里也挂上**。原生不会去调它，但这样一来，
   * 在浏览器里手工调一句就能完整走一遍真实通路（`window.__onNativeInsets(32,0,16,0,0,320)`）——
   * 键盘、系统栏这些我在这台电脑上验不了，留个口子比盲改强。
   */
  window.__onNativeInsets = (top, right, bottom, left, tappableBottom, keyboard) => {
    apply(top, right, bottom, left, tappableBottom, keyboard)
    report = { ...report, source: '原生·推送', top, right, bottom, left, tappableBottom, keyboard }
  }

  if (!Capacitor.isNativePlatform()) return

  // 只有装成 app 才是沉浸式。浏览器里没有系统栏，同一段留白会在页面顶上凭空多一条白边
  document.documentElement.classList.add('native')

  try {
    const v = await SafeArea.getInsets()
    if (v.available && typeof v.top === 'number') {
      const top = v.top ?? 0
      const right = v.right ?? 0
      const bottom = v.bottom ?? 0
      const left = v.left ?? 0
      const tappableBottom = v.tappableBottom ?? bottom
      apply(top, right, bottom, left, tappableBottom)
      report = {
        source: '原生·问答',
        top,
        right,
        bottom,
        left,
        tappableBottom,
        tappableRaw: v.tappableRaw,
        navMode: v.navMode,
        sdk: v.sdk,
        density: v.density,
        build: BUILD_STAMP
      }
      return
    }
    // 原生说它自己也没取到 —— 退回 env()
    const env = readEnvInsets()
    const gotSomething = env.top > 0 || env.bottom > 0
    apply(env.top, env.right, env.bottom, env.left, env.bottom)
    report = {
      source: gotSomething ? 'env()' : '没拿到（用保底）',
      ...env,
      tappableBottom: env.bottom,
      navMode: v.navMode,
      sdk: v.sdk,
      density: v.density,
      build: BUILD_STAMP
    }
  } catch (e) {
    const env = readEnvInsets()
    apply(env.top, env.right, env.bottom, env.left, env.bottom)
    report = {
      source: env.top > 0 || env.bottom > 0 ? 'env()' : '没拿到（用保底）',
      ...env,
      tappableBottom: env.bottom,
      error: e instanceof Error ? e.message : String(e),
      build: BUILD_STAMP
    }
  }
}
