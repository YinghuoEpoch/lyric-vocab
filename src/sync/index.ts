import localforage from 'localforage'
import { getAppData, replaceAllData } from '../storage'
import type { AppData } from '../types'
import { mergeAppData, onlyProgressChanged, type MergeReport } from './merge'
import { formatSize } from './codec'
import {
  ensureFolder,
  getRemote,
  headRemoteEtag,
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
/** 上次见到的云端版本号。用来判断「云端没变过」，从而**整份下载都省掉** */
const ETAG_KEY = 'lyric-vocab-sync-etag'

function loadEtag(): string | null {
  try {
    return localStorage.getItem(ETAG_KEY)
  } catch {
    return null
  }
}

function saveEtag(etag: string | undefined): void {
  try {
    if (etag) localStorage.setItem(ETAG_KEY, etag)
    else localStorage.removeItem(ETAG_KEY)
  } catch {
    /* 忽略：最坏就是下次多下一次 */
  }
}

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
  /** 这一次实际走了多少流量，写成人看的样子。「没走」就是两边都没变，只问了一句 */
  traffic: string
}

/**
 * 同步一次。
 *
 * ⚠️ **「云端在这中间被改过」要重来一遍，不能硬盖**（StaleError）。
 * 两台设备几乎同时同步时会撞上，硬盖就会吃掉一边的改动，而且神不知鬼不觉。
 * 重来一次是安全的：三方合并是幂等的，再合一遍只会把对面新写的那些也吸收进来。
 */
export async function syncNow(
  cfg: SyncConfig = loadSyncConfig(),
  /** 自动跑的（回前台、改完延迟）。手动那颗按钮传 false —— 它不受省流量那几道闸限制 */
  auto = false
): Promise<SyncOutcome> {
  if (!isSyncReady(cfg)) throw new SyncError('还没填全（账号、应用密码、文件夹）')

  for (let attempt = 0; attempt < 2; attempt++) {
    const local = await getAppData()
    const base = await loadBase()

    /*
     * ⚠️ **先问一句「变了没有」，别张口就把整份拉下来。**
     *
     * 用户问过「这么高频率的同步会不会用完额度」—— 会。他那份数据是整本整本的小说，
     * 好几兆；而绝大多数次同步其实两边都没动过。一次 HEAD 几百字节，一次 GET 好几兆，
     * 差着四个数量级。
     *
     * 两个条件同时成立才敢跳过：**云端版本号和上次一样**（对面没动），
     * 且**本地和底本一模一样**（我也没动）。少一个都不能跳。
     */
    /*
     * 「我这边没动过」——自动同步时，**只有阅读进度变了也算没动过**。
     * 那是流量的头号大户，见 merge.ts 里 onlyProgressChanged 的说明。
     * 进度不会因此丢：下次有别的东西要传时，它顺路就一起走了。
     */
    const localIdle = base
      ? sameJson(local, base) || (auto && onlyProgressChanged(base, local))
      : false

    const seenEtag = loadEtag()
    if (seenEtag && localIdle) {
      const nowEtag = await headRemoteEtag(cfg)
      if (nowEtag && nowEtag === seenEtag) {
        return { report: zero(), localChanged: false, at: Date.now(), traffic: '没走流量' }
      }
    }

    const remote = await getRemote(cfg)

    // 云端还没有这个文件：第一次，直接把本地传上去
    if (remote.text === null) {
      // 云端一个文件都没有：先把文件夹建出来（坚果云要求文件必须在已存在的文件夹里），
      // 再把本地整份传上去。建不成也照样试着传 —— 万一它其实在，只是 MKCOL 不给建
      const folder = await ensureFolder(cfg)
      let up = { bytes: 0 }
      try {
        up = await putRemote(cfg, envelope(local))
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
      // 刚写完，云端版本号得重新问一次才准 —— 不问就会白下一次
      saveEtag((await headRemoteEtag(cfg)) ?? undefined)
      return {
        report: zero(),
        localChanged: false,
        at: Date.now(),
        traffic: `传了 ${formatSize(up.bytes)}`
      }
    }

    const remoteData = parseEnvelope(remote.text)
    const { merged, report } = mergeAppData(base, local, remoteData)

    const localChanged = !sameJson(merged, local)
    const remoteNeedsWrite = !sameJson(merged, remoteData)

    let upBytes = 0
    if (remoteNeedsWrite) {
      /*
       * 覆盖之前把云端那一版另存一份 —— 合并要是有 bug，这是唯一能捞回来的东西
       * （第二十一节的教训）。
       *
       * 但**不必每次都存**：那等于每次同步的上传量翻倍，而用户的免费额度是按月算的。
       * 一小时一份足够了 —— 真出事也是「最多丢一小时内的合并结果」，
       * 而且本地还留着底本，两头都不是唯一副本。
       */
      if (shouldWritePrev()) {
        await putPrev(cfg, remote.text)
        markPrevWritten()
      }
      try {
        const up = await putRemote(cfg, envelope(merged), remote.etag)
        upBytes = up.bytes
      } catch (e) {
        if (e instanceof StaleError && attempt === 0) continue // 重来一遍
        throw e
      }
    }

    if (localChanged) await replaceAllData(merged)
    await saveBase(merged)
    saveEtag(remoteNeedsWrite ? ((await headRemoteEtag(cfg)) ?? undefined) : remote.etag)
    const down = remote.bytes ?? 0
    return {
      report,
      localChanged,
      at: Date.now(),
      traffic: `下 ${formatSize(down)}${upBytes ? ` / 上 ${formatSize(upBytes)}` : ''}`
    }
  }

  throw new SyncError('云端一直在变，试了两次都没写进去，过一会儿再试')
}

/** 存底最多一小时一份。见上面 shouldWritePrev 处的说明 */
const PREV_KEY = 'lyric-vocab-sync-prev-at'
const PREV_EVERY_MS = 60 * 60 * 1000

function shouldWritePrev(): boolean {
  try {
    const last = Number(localStorage.getItem(PREV_KEY)) || 0
    return Date.now() - last > PREV_EVERY_MS
  } catch {
    return true
  }
}

function markPrevWritten(): void {
  try {
    localStorage.setItem(PREV_KEY, String(Date.now()))
  } catch {
    /* 忽略 */
  }
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
