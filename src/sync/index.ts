import localforage from 'localforage'
import { getAppData, replaceAllData } from '../storage'
import type { AppData } from '../types'
import { mergeAppData, type MergeReport } from './merge'
import {
  ensureFolder,
  getRemote,
  isSyncReady,
  loadSyncConfig,
  putPrev,
  putRemote,
  StaleError,
  SyncError,
  type SyncConfig
} from './webdav'

/**
 * 同步一次是怎么走的。
 *
 * 取云端 → 和本地、底本三方合并 → 本地存合并结果 → 写回云端 → 把合并结果记成新底本。
 *
 * **底本**（上次同步完是什么样）是三方合并的依据，见 merge.ts 开头那段。
 * 存在单独的库里，不进主数据、也不进导出的备份 ——
 * 它是「这台机器同步到哪儿了」，换台机器毫无意义。
 */

const baseStore = localforage.createInstance({
  name: 'lyric-vocab',
  storeName: 'sync_base',
  description: '上次同步完成时的数据快照（三方合并的底本）'
})

const BASE_KEY = 'base'

export async function loadBase(): Promise<AppData | null> {
  try {
    return (await baseStore.getItem<AppData>(BASE_KEY)) ?? null
  } catch {
    return null
  }
}

async function saveBase(data: AppData): Promise<void> {
  try {
    await baseStore.setItem(BASE_KEY, data)
  } catch {
    /* 底本存不下：下次同步会当成「第一次」，结果是并集 —— 不会丢东西，只是可能多留几条 */
  }
}

/** 忘掉底本。换账号、或者用户想强制走一次「并集」时用 */
export async function clearBase(): Promise<void> {
  try {
    await baseStore.removeItem(BASE_KEY)
  } catch {
    /* 忽略 */
  }
}

/** 存进云端那个文件长什么样 */
interface SyncEnvelope {
  version: 1
  savedAt: number
  data: AppData
}

function parseEnvelope(text: string): AppData {
  const parsed = JSON.parse(text)
  // 直接就是一份 AppData 也认（比如用户自己把备份文件传上去了）
  const data = parsed?.data ?? parsed
  if (!data || typeof data !== 'object' || !Array.isArray(data.pages)) {
    throw new SyncError('云端那个文件不像是这个 app 的数据')
  }
  return data as AppData
}

export interface SyncOutcome {
  report: MergeReport
  /** 本地被合并结果改动了吗 —— 界面据此决定要不要刷新 */
  localChanged: boolean
  at: number
}

/**
 * 同步一次。
 *
 * ⚠️ **「云端在这中间被改过」要重来一遍，不能硬盖**（StaleError）。
 * 两台设备几乎同时同步时会撞上，硬盖就会吃掉一边的改动，而且神不知鬼不觉。
 * 重来一次是安全的：三方合并是幂等的，再合一遍只会把对面新写的那些也吸收进来。
 */
export async function syncNow(cfg: SyncConfig = loadSyncConfig()): Promise<SyncOutcome> {
  if (!isSyncReady(cfg)) throw new SyncError('还没填全（账号、应用密码、文件夹）')

  for (let attempt = 0; attempt < 2; attempt++) {
    const local = await getAppData()
    const remote = await getRemote(cfg)
    const base = await loadBase()

    // 云端还没有这个文件：第一次，直接把本地传上去
    if (remote.text === null) {
      // 云端一个文件都没有：先把文件夹建出来（坚果云要求文件必须在已存在的文件夹里），
      // 再把本地整份传上去。建不成也照样试着传 —— 万一它其实在，只是 MKCOL 不给建
      const folder = await ensureFolder(cfg)
      try {
        await putRemote(cfg, envelope(local))
      } catch (e) {
        if (!folder.ok && e instanceof SyncError) {
          throw new SyncError(
            `${e.message}。自动建文件夹也没成（${folder.detail}）—— ` +
              `去坚果云网页上手工建一个叫「${cfg.folder}」的同步文件夹，再回来试`
          )
        }
        throw e
      }
      await saveBase(local)
      return { report: zero(), localChanged: false, at: Date.now() }
    }

    const remoteData = parseEnvelope(remote.text)
    const { merged, report } = mergeAppData(base, local, remoteData)

    const localChanged = !sameJson(merged, local)
    const remoteNeedsWrite = !sameJson(merged, remoteData)

    if (remoteNeedsWrite) {
      // 覆盖之前先把云端这一版另存一份。合并有 bug 的话，这是唯一能捞回来的东西
      await putPrev(cfg, remote.text)
      try {
        await putRemote(cfg, envelope(merged), remote.etag)
      } catch (e) {
        if (e instanceof StaleError && attempt === 0) continue // 重来一遍
        throw e
      }
    }

    if (localChanged) await replaceAllData(merged)
    await saveBase(merged)
    return { report, localChanged, at: Date.now() }
  }

  throw new SyncError('云端一直在变，试了两次都没写进去，过一会儿再试')
}

function envelope(data: AppData): string {
  const payload: SyncEnvelope = { version: 1, savedAt: Date.now(), data }
  return JSON.stringify(payload)
}

function sameJson(a: unknown, b: unknown): boolean {
  return JSON.stringify(a) === JSON.stringify(b)
}

function zero(): MergeReport {
  return { pulled: 0, pushed: 0, rescued: 0, conflicts: 0 }
}

/** 上次同步成功是什么时候。只是给界面显示，存 localStorage 就够 */
const LAST_KEY = 'lyric-vocab-sync-last'

export function getLastSyncAt(): number {
  try {
    const n = Number(localStorage.getItem(LAST_KEY))
    return Number.isFinite(n) && n > 0 ? n : 0
  } catch {
    return 0
  }
}

export function setLastSyncAt(at: number): void {
  try {
    localStorage.setItem(LAST_KEY, String(at))
  } catch {
    /* 忽略 */
  }
}

export * from './webdav'
export * from './merge'
