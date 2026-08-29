import { useEffect, useRef } from 'react'

/**
 * 安卓返回键的统一调度。
 *
 * 问题：可以被「返回」关掉的东西分散在好几个组件里 —— 回收站和彻底删除确认框
 * 在左侧栏内部，长按单词的抽屉在阅读器内部，侧栏开合和确认弹窗在最外层。
 * 谁都看不到全局，没法自己决定「这次返回该由我处理吗」。
 *
 * 而 Capacitor 的返回键事件是广播给所有监听者的，没有「我处理了就别传下去」的机制，
 * 各自监听会导致一按返回把所有层一起关掉。
 *
 * 做法：全 app 只有一个真正的返回键监听（在 App.tsx 里），各组件把自己的关闭动作
 * 连同优先级登记到这里。按下返回时只执行优先级最高的那一个，实现「一次关一层」。
 * 没有任何登记项时才真正退出 App。
 */

/** 优先级：数字越大越先被关掉。集中定义，避免各处自己拍脑袋取值。 */
export const BackPriority = {
  /** 「原文已删除」确认弹窗：需要用户做决定，最优先 */
  orphanPrompt: 100,
  /** 彻底删除的二次确认（叠在回收站之上） */
  confirmDelete: 90,
  /** 回收站面板 */
  recycleBin: 80,
  /** 设置页（和回收站同一层，都是从底栏开出来的一屏，不会同时开着） */
  settings: 80,
  /** 长按单词后的抽屉与选区 */
  wordDrawer: 70,
  /** 左右侧栏 */
  panel: 60,
  /** 编辑全文模式 */
  editMode: 50
} as const

interface Entry {
  id: number
  priority: number
  handler: () => void
}

const entries: Entry[] = []
let nextId = 1

/**
 * 登记一层可被返回键关闭的界面，返回注销函数。
 * 一般通过 useBackHandler 使用；单独导出是为了能脱离 React 做测试。
 */
export function pushBackHandler(priority: number, handler: () => void): () => void {
  const id = nextId++
  entries.push({ id, priority, handler })
  return () => {
    const i = entries.findIndex((e) => e.id === id)
    if (i >= 0) entries.splice(i, 1)
  }
}

/**
 * 执行当前优先级最高的关闭动作。
 * @returns 是否有人处理了这次返回（false 表示没东西可关，调用方应退出 App）
 */
export function handleBackPress(): boolean {
  if (entries.length === 0) return false

  // 同优先级时取最后登记的那个（更晚打开的更靠上）
  let top = entries[0]
  for (const e of entries) {
    if (e.priority >= top.priority) top = e
  }

  top.handler()
  return true
}

/**
 * 当 active 为真时，把 handler 登记为「返回键可以关掉的一层」。
 *
 * @param active   这一层当前是否打开
 * @param priority 见 BackPriority
 * @param handler  关闭动作
 */
export function useBackHandler(active: boolean, priority: number, handler: () => void): void {
  // 用 ref 存最新的 handler，这样 handler 每次渲染重建也不会反复注册注销
  const handlerRef = useRef(handler)
  handlerRef.current = handler

  useEffect(() => {
    if (!active) return
    return pushBackHandler(priority, () => handlerRef.current())
  }, [active, priority])
}
