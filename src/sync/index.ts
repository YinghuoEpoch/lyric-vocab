import localforage from 'localforage'
import { getAppData, replaceAllData } from '../storage'
import type { AppData } from '../types'
import { formatSize } from './codec'
import { mergeAppData, onlyProgressChanged, type MergeReport } from './merge'
import {
  contentsOf,
  fromIndex,
  looksLikeLegacy,
  orphanPages,
  pagesToDownload,
  pagesToUpload,
  toIndex,
  type SyncIndex
} from './split'
import {
  deletePageContent,
  ensureFolder,
  getPageContent,
  getRemote,
  headRemoteEtag,
  isSyncReady,
  loadSyncConfig,
  putPageContent,
  putPrev,
  putRemote,
  StaleError,
  SyncError,
  type SyncConfig
} from './webdav'

/**
 * 同步一次是怎么走的。
 *
 * 取索引 → 和本地、底本三方合并 → 只取／只传**真变过的那几篇正文** →
 * 本地存合并结果 → 写回索引 → 把合并结果记成新底本。
 *
 * **底本**（上次同步完是什么样）是三方合并的依据，见 merge.ts 开头那段。
 * 存在单独的库里，不进主数据、也不进导出的备份 ——
 * 它是「这台机器同步到哪儿了」，换台机器毫无意义。
 * 底本存的是**完整数据**（含正文）：它只在本机、不走网络，存全了才好比。
 *
 * **正文和索引拆开存**的缘由见 split.ts —— 一句话：用户划一个词改的是 17 KB，
 * 而原先要把 1.44 MB 整个重传一遍。
 */

const baseStore = localforage.createInstance({
  name: 'lyric-vocab',
  storeName: 'sync_base',
  description: '上次同步完成时的数据快照（三方合并的底本）'
})

const BASE_KEY = 'base'
/** 上次见到的云端版本号。用来判断「云端没变过」，从而**连索引都不用下** */
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
    /* 忽略：最坏就是下次多问一次 */
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

/** 忘掉底本。换账号、或者想强制走一次「并集」时用 */
export async function clearBase(): Promise<void> {
  try {
    await baseStore.removeItem(BASE_KEY)
  } catch {
    /* 忽略 */
  }
}

/** 存进云端那个索引文件长什么样 */
interface SyncEnvelope {
  /** 1 = 旧格式（正文就在这一整块里）；2 = 索引，正文另存 */
  version: 1 | 2
  savedAt: number
  data: SyncIndex | AppData
}

/**
 * 把云端那份读成索引。
 *
 * ⚠️ **旧格式也要认**：用户云端已经有一份 version 1 的（正文就在里面），
 * 读不出来等于把他同步上去的东西弄丢。认出来之后正文直接从那一份里取，
 * 下一次写回去时自动变成新格式。
 */
function parseRemote(text: string): { index: SyncIndex; contents: Map<string, string> | null } {
  const parsed = JSON.parse(text)
  const data = parsed?.data ?? parsed
  if (!data || typeof data !== 'object' || !Array.isArray(data.pages)) {
    throw new SyncError('云端那个文件不像是这个 app 的数据')
  }
  if (looksLikeLegacy(data)) {
    const full = data as AppData
    return { index: toIndex(full), contents: contentsOf(full) }
  }
  return { index: data as SyncIndex, contents: null }
}

export interface SyncOutcome {
  report: MergeReport
  /** 本地被合并结果改动了吗 —— 界面据此决定要不要刷新 */
  localChanged: boolean
  at: number
  /** 这一次实际走了多少流量，写成人看的样子 */
  traffic: string
  /** 这一次上下行各多少字节。给流量记账用（见 usage.ts）—— 从前算完就扔了 */
  up: number
  down: number
}

/**
 * 同步一次。
 *
 * ⚠️ **「云端在这中间被改过」要重来一遍，不能硬盖**（StaleError）。
 * 两台设备几乎同时同步时会撞上，硬盖就会吃掉一边的改动，而且神不知鬼不觉。
 * 重来一次是安全的：三方合并是幂等的，再合一遍只会把对面新写的也吸收进来。
 */
export async function syncNow(
  cfg: SyncConfig = loadSyncConfig(),
  /** 自动跑的（回前台、改完延迟）。手动那颗按钮传 false —— 不受省流量那几道闸限制 */
  auto = false
): Promise<SyncOutcome> {
  if (!isSyncReady(cfg)) throw new SyncError('还没填全（账号、应用密码、文件夹）')

  for (let attempt = 0; attempt < 2; attempt++) {
    const local = await getAppData()
    const base = await loadBase()

    /*
     * 「我这边没动过」——自动同步时，**只有阅读进度变了也算没动过**。
     * 见 merge.ts 里 onlyProgressChanged 的说明。
     * 进度不会因此丢：下次有别的东西要传时，它顺路就一起走了。
     */
    const localIdle = base
      ? sameJson(local, base) || (auto && onlyProgressChanged(base, local))
      : false

    /*
     * ⚠️ **先问一句「变了没有」，别张口就把索引拉下来。** 一次 HEAD 几百字节。
     * 两个条件同时成立才敢跳过：云端版本号和上次一样，且本地没动过。
     */
    const seenEtag = loadEtag()
    if (seenEtag && localIdle) {
      const nowEtag = await headRemoteEtag(cfg)
      if (nowEtag && nowEtag === seenEtag) {
        return { report: zero(), localChanged: false, at: Date.now(), traffic: '没走流量', up: 0, down: 0 }
      }
    }

    const remote = await getRemote(cfg)
    let down = remote.bytes ?? 0
    let up = 0

    // 云端一个文件都没有：第一次，索引和每篇正文都传上去
    if (remote.text === null) {
      const folder = await ensureFolder(cfg)
      try {
        up += (await putRemote(cfg, envelope(toIndex(local)))).bytes
      } catch (e) {
        if (!folder.ok && e instanceof SyncError) {
          throw new SyncError(
            `${e.message}。自动建文件夹也没成（${folder.detail}）—— ` +
              `去坚果云网页上手工建一个叫「${cfg.folder}」的同步文件夹，再回来试`
          )
        }
        throw e
      }
      for (const [id, content] of contentsOf(local)) {
        up += (await putPageContent(cfg, id, content)).bytes
      }
      await saveBase(local)
      saveEtag((await headRemoteEtag(cfg)) ?? undefined)
      return {
        report: zero(),
        localChanged: false,
        at: Date.now(),
        traffic: `传了 ${formatSize(up)}`,
        up,
        down
      }
    }

    const { index: remoteIndex, contents: legacyContents } = parseRemote(remote.text)

    /*
     * 合并走的是**索引**，不是完整数据 —— 正文在索引里只是一枚指纹。
     * 「正文改了」照样会被合并看见（指纹变了，那条记录就不一样了），
     * 而合并本身完全不必碰那几兆正文。**merge.ts 一个字都没动。**
     */
    const localIndex = toIndex(local)
    const baseIndex = base ? toIndex(base) : null
    const { merged: mergedIndex, report } = mergeAppData(
      baseIndex as unknown as AppData | null,
      localIndex as unknown as AppData,
      remoteIndex as unknown as AppData
    ) as unknown as { merged: SyncIndex; report: MergeReport }

    /* 正文：手上有的就用手上的，只把对不上的那几篇取回来 */
    const contents = contentsOf(local)
    if (legacyContents) {
      // 旧格式那一份里带着正文，先拿来用，省得再下一遍
      for (const [id, c] of legacyContents) if (!contents.has(id)) contents.set(id, c)
    }
    for (const id of pagesToDownload(mergedIndex, contents)) {
      const got = await getPageContent(cfg, id)
      if (got !== null) {
        contents.set(id, got)
        down += got.length
      }
    }

    /*
     * ⚠️ 旧的 `notes` 不上云（见 split.ts），所以合并结果里没有它 ——
     * **必须把本地那份原样带回来**。少这一下，replaceAllData 会把它抹成空的。
     */
    const merged = fromIndex(mergedIndex, contents, local.notes ?? {})
    const localChanged = !sameJson(merged, local)
    const remoteNeedsWrite = !sameJson(mergedIndex, remoteIndex) || legacyContents !== null

    if (remoteNeedsWrite) {
      /*
       * 覆盖之前把云端那一版另存一份 —— 合并要是有 bug，这是唯一能捞回来的东西
       * （第二十一节的教训）。但**不必每次都存**：一小时一份足够，
       * 真出事也就是「最多丢一小时内的合并结果」，何况本地还留着底本。
       */
      if (shouldWritePrev()) {
        await putPrev(cfg, remote.text)
        markPrevWritten()
      }
      /*
       * ⚠️ **先传正文，再写索引，顺序不能反。**
       * 索引先写成功而正文还没传完的话，另一台会看到一篇「有壳没正文」的文档，
       * 而且它那边一比对指纹，会当成「对面把正文改成空的了」——
       * 那就不是慢一步的问题，是真会把正文冲掉。
       */
      for (const id of pagesToUpload(mergedIndex, remoteIndex)) {
        up += (await putPageContent(cfg, id, contents.get(id) ?? '')).bytes
      }
      try {
        up += (await putRemote(cfg, envelope(mergedIndex), remote.etag)).bytes
      } catch (e) {
        if (e instanceof StaleError && attempt === 0) continue // 重来一遍
        throw e
      }
      // 顺手清掉没人要的正文文件。失败无所谓，留个死文件不影响任何事
      for (const id of orphanPages(mergedIndex, remoteIndex)) await deletePageContent(cfg, id)
    }

    if (localChanged) await replaceAllData(merged)
    await saveBase(merged)
    saveEtag(remoteNeedsWrite ? ((await headRemoteEtag(cfg)) ?? undefined) : remote.etag)
    return {
      report,
      localChanged,
      at: Date.now(),
      traffic: `下 ${formatSize(down)}${up ? ` / 上 ${formatSize(up)}` : ''}`,
      up,
      down
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

function envelope(index: SyncIndex): string {
  const payload: SyncEnvelope = { version: 2, savedAt: Date.now(), data: index }
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
export * from './split'
