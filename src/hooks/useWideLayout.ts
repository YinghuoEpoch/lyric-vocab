import { useEffect, useState } from 'react'

/**
 * 「宽屏布局」这条线。
 *
 * **量的是可用宽度，不是设备种类。** 从前有过一个 useIsMobile，2026-08-28 连同
 * 桌面端那套并行交互一起删掉了 —— 按设备分叉最后总会变成两套各自长歪的逻辑。
 * 这里只回答一个问题：**现在这块地方，够不够摆得下三栏。**
 * 手势、朗读那些一律不看这个值，全平台都是同一套（长按取词）。
 *
 * ## 为什么是 1024
 *
 * 从前这条线是 768（Tailwind 默认的 md）。手机永远够不到，所以那套三栏布局
 * 从来没人验过；而平板竖屏正好落在 768 上面一点，于是拿到了一套摆不下的布局。
 * 量过（2026-09-03）：
 *
 * | 屏幕 | 笔记栏关着的正文宽 | 笔记栏打开后的正文宽 |
 * |---|---|---|
 * | 768（iPad 竖屏） | 518 / 文字 444 | 168 / **文字 94** |
 * | 800（安卓平板竖屏） | 550 / 文字 476 | 200 / **文字 126** |
 * | 1280×800（横屏） | 1030 / 文字 674 | 680 / 文字 606 |
 *
 * 文字 94px 是一行放不下两个词。左栏 250 + 右栏 350 = 600，从 768 里挖走六成。
 *
 * 1024 这条线把平板竖屏（768～1023）划给手机那套 —— 侧栏浮起来盖住正文，
 * 正文永远是整宽，而那套是验熟的；横屏（1024 起）才走三栏。
 *
 * ⚠️ **这个数和 tailwind.config.js 里的 `wide` 断点必须一致**，
 * 一个管 JS 里的判断，一个管 `wide:` 那些类名，两边对不上就会出现
 * 「布局已经变了、JS 还以为没变」的错位。
 */
export const WIDE_PX = 1024

const QUERY = `(min-width: ${WIDE_PX}px)`

/** 此刻算不算宽屏。给事件回调里用 —— 那种地方拿不到 hook 的值 */
export function isWideNow(): boolean {
  return typeof window !== 'undefined' && window.matchMedia(QUERY).matches
}

/**
 * 跟着屏幕变的「算不算宽屏」。
 *
 * 平板转屏是会当场跨过这条线的（800 竖 → 1280 横），所以必须监听，
 * 不能只在挂载时读一次。
 */
export function useIsWide(): boolean {
  const [wide, setWide] = useState(isWideNow)

  useEffect(() => {
    const mq = window.matchMedia(QUERY)
    const onChange = () => setWide(mq.matches)
    mq.addEventListener('change', onChange)
    /*
     * **resize 也听一份。** 只听 matchMedia 的 change 有过一次落空：
     * 浏览器里改视口尺寸时 CSS 的 `wide:` 已经生效了，JS 这边却还是旧值 ——
     * 于是「布局已经变了、按钮还以为没变」，点汉堡键没有反应。
     * 两个都听，谁先到都行；值没变时 setState 传同一个布尔值，React 不会重渲染。
     */
    window.addEventListener('resize', onChange)
    // 挂载到监听装上之间可能已经变过一次，补读一下
    onChange()
    return () => {
      mq.removeEventListener('change', onChange)
      window.removeEventListener('resize', onChange)
    }
  }, [])

  return wide
}

/** 左边那栏此刻看不看得见，要看的三件事 */
export interface LeftSidebarVisibility {
  /** 够不够宽（1024 起）。宽窄两套**收起机制**不一样，见下面 */
  isWide: boolean
  /** 宽屏上左栏收起来了没有（窄屏不看这一格） */
  wideLeftHidden: boolean
  /** 窄屏上那层浮层此刻是不是呼出着（宽屏不看这一格） */
  narrowPanelOpen: boolean
}

/**
 * 左边那栏此刻是不是**看得见**。
 *
 * ## 为什么要有这么一个函数
 *
 * 「收起左栏」有**两套互不相干的机制**，取决于屏幕宽度（见 App.tsx 那颗汉堡键）：
 *
 * - **宽屏（平板横屏）**：改 `wideLeftHidden`，`activePanel` 一动不动
 * - **窄屏（手机、平板竖屏）**：改 `activePanel`，`wideLeftHidden` 一动不动
 *
 * 于是「左栏收起来了吗」这个问题有两个平行的真相来源，
 * **只认其中一个的组件必然在另一种宽度下失灵**。
 *
 * 2026-09-07 就栽过一次：`LeftSidebar` 只拿到窄屏那一套，
 * 于是「收起侧栏自动退出整理模式」在平板横屏上从来没生效过 ——
 * 收起来再放出来，还停在整理模式里。窄屏一切正常，所以一直没人发现。
 *
 * 这和第六十、六十九节是同一个病：**同一件事有 N 个平行的登记处，
 * N 大于 1 就已经是 bug 了。** 治法是合成一个答案，让调用方没得选。
 *
 * ⚠️ 再有「左栏是不是开着」的判断，一律走这里，别自己拼那个三元表达式。
 */
export function isLeftSidebarVisible(c: LeftSidebarVisibility): boolean {
  return c.isWide ? !c.wideLeftHidden : c.narrowPanelOpen
}
