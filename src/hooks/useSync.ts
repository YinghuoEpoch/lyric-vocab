import { useCallback, useEffect, useRef, useState } from 'react'
import {
  getLastSyncAt,
  isSyncReady,
  loadSyncConfig,
  setLastSyncAt,
  syncNow,
  type MergeReport,
  type SyncOutcome
} from '../sync'

/**
 * 什么时候同步。
 *
 * 用户要的是「在一台设备划了词，另一台也同步」。**但真正的即时是看不见的** ——
 * 那会儿另一台在兜里锁着。他真正要的是「**拿起另一台的时候，东西是新的**」。
 * 所以不做长连接推送（那要一台一直连着的服务器，坚果云给不了），只做两下：
 *
 * - **回到前台就同步一次** —— 拿起另一台的那一刻，正好是这一下
 * - **改完东西过几秒同步一次** —— 让对面下次拿起来时是新的
 *
 * 效果和「即时」没有区别，代价小一个数量级。
 */

/** 隔多久把「刚改过的东西」传上去。太短会一路上传，太长则换设备时可能还没传完 */
const PUSH_DELAY_MS = 8000

export type SyncState = 'idle' | 'syncing' | 'ok' | 'error'

export interface SyncStatus {
  state: SyncState
  /** 上次成功是什么时候（毫秒时间戳），0 表示还没成功过 */
  lastAt: number
  /** 上次合并的结果，给界面报数 */
  report: MergeReport | null
  /** 失败时服务器的原话。⚠️ 不翻译 —— 我验不了用户的账号，只能把原话交给他 */
  error: string | null
}

export function useSync(onDataChanged: () => void) {
  const [status, setStatus] = useState<SyncStatus>({
    state: 'idle',
    lastAt: getLastSyncAt(),
    report: null,
    error: null
  })
  const running = useRef(false)
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null)
  /** 同步过程中会写本地数据，那又会触发「数据变了」—— 不挡一下就会自己叫自己 */
  const suppress = useRef(false)

  const run = useCallback(
    async (silent: boolean) => {
      const cfg = loadSyncConfig()
      if (!isSyncReady(cfg)) return
      if (running.current) return
      running.current = true
      if (!silent) setStatus((s) => ({ ...s, state: 'syncing', error: null }))
      try {
        suppress.current = true
        const outcome: SyncOutcome = await syncNow(cfg)
        setLastSyncAt(outcome.at)
        setStatus({ state: 'ok', lastAt: outcome.at, report: outcome.report, error: null })
        // 合进来的东西要让界面看见。没这一句，同步完屏幕上还是旧的
        if (outcome.localChanged) onDataChanged()
      } catch (e) {
        const msg = (e instanceof Error ? e.message : String(e ?? '')).trim()
        setStatus((s) => ({ ...s, state: 'error', error: msg || '同步失败，没有更多信息' }))
      } finally {
        running.current = false
        // 放开得晚一点：replaceAllData 之后界面还会再刷一轮
        setTimeout(() => {
          suppress.current = false
        }, 1000)
      }
    },
    [onDataChanged]
  )

  /** 手动那颗按钮 */
  const syncManually = useCallback(() => void run(false), [run])

  /** 数据改过了，过一会儿传上去。期间又改，就重新计时 —— 连续编辑只在停手后传一次 */
  const notifyChanged = useCallback(() => {
    if (suppress.current) return
    if (!isSyncReady(loadSyncConfig())) return
    if (timer.current) clearTimeout(timer.current)
    timer.current = setTimeout(() => {
      timer.current = null
      void run(true)
    }, PUSH_DELAY_MS)
  }, [run])

  /* 回到前台就同步一次 —— 「拿起另一台」的那一刻正好是这一下 */
  useEffect(() => {
    const onVisible = () => {
      if (!document.hidden) void run(true)
    }
    document.addEventListener('visibilitychange', onVisible)
    // 启动时也来一次
    void run(true)
    return () => document.removeEventListener('visibilitychange', onVisible)
  }, [run])

  useEffect(
    () => () => {
      if (timer.current) clearTimeout(timer.current)
    },
    []
  )

  return { status, syncManually, notifyChanged }
}
