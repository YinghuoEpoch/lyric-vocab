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
import { addUsage } from '../sync/usage'

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

/**
 * 自动同步之间至少隔这么久。
 *
 * ⚠️ 这道闸是为**流量**加的（用户问过会不会用完额度）。真正咬人的不是「改笔记」，
 * 是**阅读进度** —— 你一路往下读，滚动位置一直在存，每次都算「数据变了」。
 * 光靠上面那个延迟不够：停手八秒传一次，接着读、再停、又传一次，一章下来传很多回。
 *
 * 手动那颗按钮不受这道闸限制 —— 人明确要同步时不该被拦。
 *
 * ⚠️ **被这道闸拦下来时要补一次，不能就地放弃**（2026-09-04 用户要求）。
 * 从前是直接 return，那一次改动就得等下一个触发点（切后台再回来、或者再改点别的）
 * 才会上去 —— 现象是「我明明改了，另一台没更新」。现在改成**约到闸开的那一刻再来**，
 * 于是「改了迟早会传上去」成立，而每分钟至多一次这个上限一点没松。
 */
const MIN_AUTO_GAP_MS = 60 * 1000

/**
 * 撞上「已经有一轮在跑」时，隔多久回来看一眼。
 *
 * 短一点没关系：回来之后还要过 MIN_AUTO_GAP_MS 那道闸，
 * 真正的上限仍然是每分钟一次，这里只是别把这次改动丢了。
 */
const RUNNING_RETRY_MS = 2000

/** 这一次到底走不走。`retry` 是「现在不行，afterMs 毫秒之后再来」 */
export type SyncGate = { kind: 'go' } | { kind: 'retry'; afterMs: number } | { kind: 'skip' }

/**
 * 该不该现在同步 —— 时机判断里唯一有分支的那一块，抽出来好钉住。
 *
 * 真身在真机上（网络、坚果云的脾气），但**走不走、什么时候补**是纯判断。
 * 两条规矩：
 *
 * 1. **手动的不受任何闸限制**，除非已经有一轮在跑（那时按钮本来就是禁用的）
 * 2. **自动的一旦被拦，一律改约，不就地放弃** —— 放弃的后果是
 *    「我明明改了，另一台没更新」，而那正是这一版要治的
 */
export function decideAutoSync(o: {
  /** 自动触发的（回前台、改完延迟）。手动那颗按钮传 false */
  silent: boolean
  /** 已经有一轮在跑 */
  running: boolean
  now: number
  /** 上一次**自动**同步是什么时候。手动的不记 */
  lastAutoAt: number
  minGapMs?: number
  runningRetryMs?: number
}): SyncGate {
  const minGap = o.minGapMs ?? MIN_AUTO_GAP_MS
  const retry = o.runningRetryMs ?? RUNNING_RETRY_MS

  if (o.running) return o.silent ? { kind: 'retry', afterMs: retry } : { kind: 'skip' }
  if (!o.silent) return { kind: 'go' }

  const wait = minGap - (o.now - o.lastAutoAt)
  return wait > 0 ? { kind: 'retry', afterMs: wait } : { kind: 'go' }
}

export type SyncState = 'idle' | 'syncing' | 'ok' | 'error'

export interface SyncStatus {
  state: SyncState
  /** 上次成功是什么时候（毫秒时间戳），0 表示还没成功过 */
  lastAt: number
  /** 上次合并的结果，给界面报数 */
  report: MergeReport | null
  /** 失败时服务器的原话。⚠️ 不翻译 —— 我验不了用户的账号，只能把原话交给他 */
  error: string | null
  /** 上一次实际走了多少流量。用户关心额度，就让他看得见 */
  traffic: string | null
}

export function useSync(onDataChanged: () => void) {
  const [status, setStatus] = useState<SyncStatus>({
    state: 'idle',
    lastAt: getLastSyncAt(),
    report: null,
    error: null,
    traffic: null
  })
  const running = useRef(false)
  /** 上一次自动同步是什么时候。手动的不算，见 MIN_AUTO_GAP_MS */
  const lastAutoAt = useRef(0)
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null)
  /** 同步过程中会写本地数据，那又会触发「数据变了」—— 不挡一下就会自己叫自己 */
  const suppress = useRef(false)

  const run = useCallback(
    async (silent: boolean) => {
      const cfg = loadSyncConfig()
      if (!isSyncReady(cfg)) return

      const gate = decideAutoSync({
        silent,
        running: running.current,
        now: Date.now(),
        lastAutoAt: lastAutoAt.current
      })
      if (gate.kind === 'skip') return
      if (gate.kind === 'retry') {
        /*
         * 改约，不放弃。借用 notifyChanged 那个定时器槽：
         * 期间用户又改了东西，那边会把这次预约顶掉、重新排一轮 ——
         * 最终还是「停手之后传一次」，不会叠加成好几次。
         */
        if (timer.current) clearTimeout(timer.current)
        timer.current = setTimeout(() => {
          timer.current = null
          void run(true)
        }, gate.afterMs)
        return
      }
      if (silent) lastAutoAt.current = Date.now()
      running.current = true
      if (!silent) setStatus((s) => ({ ...s, state: 'syncing', error: null }))
      try {
        suppress.current = true
        const outcome: SyncOutcome = await syncNow(cfg, silent)
        setLastSyncAt(outcome.at)
        // 记真账。估算这条路错过两次了，见 sync/usage.ts
        addUsage(outcome.up, outcome.down)
        setStatus({
          state: 'ok',
          lastAt: outcome.at,
          report: outcome.report,
          error: null,
          traffic: outcome.traffic
        })
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
