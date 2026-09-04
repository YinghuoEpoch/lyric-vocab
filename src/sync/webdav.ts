import { Capacitor, CapacitorHttp } from '@capacitor/core'
import { pack, unpack } from './codec'

/**
 * WebDAV 读写（坚果云）。
 *
 * 只用三个动作：**取一个文件、放一个文件、建一个文件夹**。
 * 选 WebDAV 而不是数据库，正是因为这个 app 的数据本来就是一整块 JSON ——
 * 要的不是「云端数据库」，只是「一个两台设备都够得着的地方放一个文件」。
 *
 * 认证是 HTTP Basic：账号 + **应用密码**（坚果云单独生成的那一串，
 * 不是登录密码，随时能单独作废）。
 *
 * **手机上走 Capacitor 的原生网络**（安卓发的请求，没有跨域这回事），
 * **电脑浏览器里走 vite 转发**（`/jgy`，见 vite.config.ts）——
 * 和取词典发音、云端朗读是同一套办法。
 */

export interface SyncConfig {
  /** 坚果云账号（邮箱） */
  username: string
  /** 应用密码。⚠️ 不是登录密码 */
  password: string
  /** 放在哪个文件夹里。默认 lyric-vocab */
  folder: string
}

export function defaultSyncConfig(): SyncConfig {
  return { username: '', password: '', folder: 'lyric-vocab' }
}

const STORAGE_KEY = 'lyric-vocab-sync'

export function isSyncReady(c: SyncConfig): boolean {
  return c.username.trim() !== '' && c.password.trim() !== '' && c.folder.trim() !== ''
}

export function loadSyncConfig(): SyncConfig {
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    if (!raw) return defaultSyncConfig()
    const p = JSON.parse(raw)
    const d = defaultSyncConfig()
    const str = (v: unknown, f: string) => (typeof v === 'string' && v.trim() ? v.trim() : f)
    return {
      username: str(p?.username, d.username),
      password: str(p?.password, d.password),
      folder: str(p?.folder, d.folder)
    }
  } catch {
    return defaultSyncConfig()
  }
}

export function saveSyncConfig(c: SyncConfig): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(c))
  } catch {
    /* 存不下就这一趟有效 */
  }
}

/** 同步这条路自己的错。带上服务器的原话 —— 我验不了用户的账号，只能把原话交给他 */
export class SyncError extends Error {}

const NATIVE_BASE = 'https://dav.jianguoyun.com/dav'
const DEV_BASE = '/jgy/dav'

/** 数据文件叫什么，以及被覆盖前那一版存哪儿 */
export const DATA_FILE = 'data.json'
export const PREV_FILE = 'data.prev.json'
/**
 * 阅读进度单独一个小文件。
 *
 * 它和 data.json 分开，是为了让「一路往下读」不再重传整份索引 ——
 * 缘由见 sync/progress.ts。几百字节，随时传得起。
 */
export const PROGRESS_FILE = 'progress.json'

/**
 * 每篇正文一个文件。
 *
 * ⚠️ **平铺，不放子目录** —— CapacitorHttp 不支持 MKCOL，建不出子目录
 * （第六十一节的坑）。所有文件只能待在用户手工建的那一个文件夹里。
 */
export function pageFile(pageId: string): string {
  return `page-${pageId}.json`
}

/**
 * 路径里的每一段都要转义。
 *
 * 文件夹名用户可以自己填，写个中文或者带空格的名字很正常 ——
 * 不转义的话请求直接就是坏的，而 WebDAV 报回来的错跟这件事看不出关系。
 */
export function davUrl(folder: string, file: string, dev = false): string {
  const base = dev ? DEV_BASE : NATIVE_BASE
  return `${base}/${encodeURIComponent(folder.trim())}/${encodeURIComponent(file)}`
}

export function basicAuth(username: string, password: string): string {
  // btoa 只认 Latin-1，密码里有非 ASCII 会抛。坚果云的应用密码是字母数字，
  // 但账号是邮箱、理论上可以有别的字符，所以先转成 UTF-8 的字节再编
  const bytes = new TextEncoder().encode(`${username}:${password}`)
  let binary = ''
  bytes.forEach((b) => {
    binary += String.fromCharCode(b)
  })
  return `Basic ${btoa(binary)}`
}

interface DavResponse {
  status: number
  text: string
  etag?: string
}

async function request(
  method: string,
  url: string,
  c: SyncConfig,
  body?: string,
  extraHeaders: Record<string, string> = {}
): Promise<DavResponse> {
  const headers: Record<string, string> = {
    Authorization: basicAuth(c.username.trim(), c.password.trim()),
    ...extraHeaders
  }
  if (body !== undefined) headers['Content-Type'] = 'application/json; charset=utf-8'

  if (Capacitor.isNativePlatform()) {
    const res = await CapacitorHttp.request({
      url,
      method,
      headers,
      data: body,
      connectTimeout: 10000,
      readTimeout: 30000
    })
    const raw = res.data
    return {
      status: res.status,
      text: typeof raw === 'string' ? raw : raw == null ? '' : JSON.stringify(raw),
      etag: pickEtag(res.headers)
    }
  }

  const res = await fetch(url, { method, headers, body })
  return { status: res.status, text: await res.text(), etag: res.headers.get('etag') ?? undefined }
}

/** 响应头的大小写各家不一样，挨个认一遍 */
function pickEtag(headers: Record<string, string> | undefined): string | undefined {
  if (!headers) return undefined
  for (const [k, v] of Object.entries(headers)) {
    if (k.toLowerCase() === 'etag') return v
  }
  return undefined
}

/** 云端那一份，连同它的 ETag（用来防「我读完到我写回去这中间对面又写了一次」） */
export interface RemoteFile {
  /** 文件内容（已经拆过箱的 JSON 文本）；云端还没有这个文件时是 null */
  text: string | null
  etag?: string
  /** 实际下载了多少字节。给界面显示「这次走了多少流量」 */
  bytes?: number
}

/**
 * 只问一句「云端那份的版本号是多少」，**不下载内容**。
 *
 * 这是省流量的关键一招：绝大多数次同步其实什么都没变，
 * 而一次 HEAD 只有几百字节，一次 GET 是好几兆。
 * 返回 null 表示云端还没有这个文件。
 */
export async function headRemoteEtag(c: SyncConfig): Promise<string | null> {
  const dev = !Capacitor.isNativePlatform()
  const res = await request('HEAD', davUrl(c.folder, DATA_FILE, dev), c)
  if (res.status === 404 || res.status === 409) return null
  if (res.status === 401) throw new SyncError('账号或应用密码不对（服务器回 401）')
  if (res.status < 200 || res.status >= 300) {
    throw new SyncError(`问云端版本失败：${res.status}${brief(res.text)}`)
  }
  return res.etag ?? null
}

export async function getRemote(c: SyncConfig): Promise<RemoteFile> {
  const dev = !Capacitor.isNativePlatform()
  const res = await request('GET', davUrl(c.folder, DATA_FILE, dev), c)
  // 404 = 文件不在；409 = **上层文件夹都不在**（坚果云是这么回的）。
  // 两种都是「云端还没有东西」，接下来该建文件夹再上传，不是报错
  if (res.status === 404 || res.status === 409) return { text: null }
  if (res.status === 401) throw new SyncError('账号或应用密码不对（服务器回 401）')
  if (res.status < 200 || res.status >= 300) {
    throw new SyncError(`取云端那份失败：${res.status}${brief(res.text)}`)
  }
  // 拆箱：压缩过的和早先那份明文的都认，见 codec.ts
  return { text: unpack(res.text), etag: res.etag, bytes: res.text.length }
}

/**
 * 写回云端。
 *
 * `ifMatch` 是「我是基于这一版改的」——中间对面要是又写过一次，服务器回 412，
 * 那时必须**重新取一遍再合一次**，绝不能硬盖。少了这一道，
 * 两台设备几乎同时同步就会吃掉一边的改动，而且神不知鬼不觉。
 */
export async function putRemote(
  c: SyncConfig,
  text: string,
  ifMatch?: string
): Promise<{ bytes: number }> {
  const dev = !Capacitor.isNativePlatform()
  const headers: Record<string, string> = ifMatch ? { 'If-Match': ifMatch } : {}
  // 装箱：压缩 + base64。用户那份数据是整本整本的小说，不压会很快吃光免费额度
  const body = pack(text)
  const res = await request('PUT', davUrl(c.folder, DATA_FILE, dev), c, body, headers)
  if (res.status === 412) throw new StaleError('云端在这中间被改过了')
  if (res.status === 409 || res.status === 404) {
    throw new SyncError(`文件夹「${c.folder}」在坚果云里不存在，先去建一个（${res.status}）`)
  }
  if (res.status === 401) throw new SyncError('账号或应用密码不对（服务器回 401）')
  if (res.status < 200 || res.status >= 300) {
    throw new SyncError(`写云端失败：${res.status}${brief(res.text)}`)
  }
  return { bytes: body.length }
}

/** 取一篇正文。云端没有就返回 null（那篇多半是别处刚加的，还没传完） */
export async function getPageContent(c: SyncConfig, pageId: string): Promise<string | null> {
  const dev = !Capacitor.isNativePlatform()
  const res = await request('GET', davUrl(c.folder, pageFile(pageId), dev), c)
  if (res.status === 404 || res.status === 409) return null
  if (res.status < 200 || res.status >= 300) {
    throw new SyncError(`取正文失败：${res.status}${brief(res.text)}`)
  }
  const parsed = JSON.parse(unpack(res.text))
  return typeof parsed?.content === 'string' ? parsed.content : ''
}

/** 传一篇正文上去。返回实际走了多少字节，界面要报流量 */
export async function putPageContent(
  c: SyncConfig,
  pageId: string,
  content: string
): Promise<{ bytes: number }> {
  const dev = !Capacitor.isNativePlatform()
  const body = pack(JSON.stringify({ id: pageId, content }))
  const res = await request('PUT', davUrl(c.folder, pageFile(pageId), dev), c, body)
  if (res.status < 200 || res.status >= 300) {
    throw new SyncError(`传正文失败：${res.status}${brief(res.text)}`)
  }
  return { bytes: body.length }
}

/**
 * 取云端的进度表。
 *
 * ⚠️ 取不到一律当**空表**，不抛错 —— 第一次同步时这个文件本来就不存在
 * （坚果云在文件夹不存在时回 409 不是 404，两个都要认，第六十一节的坑）。
 * 内容坏了也当空表：进度丢了顶多是回到上次的位置，
 * 而为它抛错会把整轮同步（笔记、正文）一起拖垮，那才是真损失。
 */
export async function getProgress(c: SyncConfig): Promise<{ map: unknown; bytes: number }> {
  const dev = !Capacitor.isNativePlatform()
  const res = await request('GET', davUrl(c.folder, PROGRESS_FILE, dev), c)
  if (res.status === 404 || res.status === 409) return { map: {}, bytes: 0 }
  if (res.status < 200 || res.status >= 300) return { map: {}, bytes: 0 }
  try {
    return { map: JSON.parse(unpack(res.text)), bytes: res.text.length }
  } catch {
    return { map: {}, bytes: res.text.length }
  }
}

/** 传进度表上去。返回实际走了多少字节，界面要报流量 */
export async function putProgress(
  c: SyncConfig,
  map: unknown
): Promise<{ bytes: number }> {
  const dev = !Capacitor.isNativePlatform()
  const body = pack(JSON.stringify(map))
  const res = await request('PUT', davUrl(c.folder, PROGRESS_FILE, dev), c, body)
  if (res.status < 200 || res.status >= 300) {
    throw new SyncError(`传进度失败：${res.status}${brief(res.text)}`)
  }
  return { bytes: body.length }
}

/** 清掉没人要的正文文件。失败就算了 —— 留一个死文件不影响任何事，报错反而吓人 */
export async function deletePageContent(c: SyncConfig, pageId: string): Promise<void> {
  const dev = !Capacitor.isNativePlatform()
  try {
    await request('DELETE', davUrl(c.folder, pageFile(pageId), dev), c)
  } catch {
    /* 见上 */
  }
}

/** 云端被覆盖之前那一版，另存一份。第二十一节的教训：救得回来才敢动 */
export async function putPrev(c: SyncConfig, text: string): Promise<void> {
  const dev = !Capacitor.isNativePlatform()
  try {
    await request('PUT', davUrl(c.folder, PREV_FILE, dev), c, pack(text))
  } catch {
    /* 存底失败不该拦着同步本身 —— 它只是保险，不是主线 */
  }
}

/** 云端那一版比我新，得重来。单独一个类型，因为处理办法完全不同（重取再合，不是报错） */
export class StaleError extends Error {}

/**
 * 建文件夹。坚果云要求文件必须在一个已存在的文件夹里。
 *
 * 建不成不报错：多半是**它本来就在**（405），那正是我们要的结果；
 * 真的建不了，后面 PUT 会报 409，那时的报错更说明问题。
 */
export async function ensureFolder(c: SyncConfig): Promise<{ ok: boolean; detail: string }> {
  const dev = !Capacitor.isNativePlatform()
  const url = `${dev ? DEV_BASE : NATIVE_BASE}/${encodeURIComponent(c.folder.trim())}`
  try {
    const res = await request('MKCOL', url, c)
    // 405 = 它本来就在，正是我们要的结果
    const ok = (res.status >= 200 && res.status < 300) || res.status === 405
    return { ok, detail: ok ? '' : `建文件夹返回 ${res.status}${brief(res.text)}` }
  } catch (e) {
    return { ok: false, detail: e instanceof Error ? e.message : String(e) }
  }
}

/**
 * 把服务器的报错变成人能读的一句。
 *
 * ⚠️ WebDAV 报错是一整坨 XML，开头一百多个字符全是 `<?xml ... xmlns:d="DAV:" ...` 这种命名空间，
 * **真正有用的那句在后面**。第一版直接截前 120 个字符，结果屏上显示的全是命名空间、
 * 一个字的线索都没有 —— 用户第一次试就撞上了这个。
 * 所以先把 `<s:message>` / `<s:exception>` 抠出来，抠不到才退回原文。
 */
export function davMessage(text: string): string {
  const pick = (tag: string) => {
    const m = text.match(new RegExp(`<[a-z]*:?${tag}[^>]*>([^]*?)</[a-z]*:?${tag}>`, 'i'))
    return m?.[1]?.trim() ?? ''
  }
  const msg = pick('message') || pick('exception') || pick('responsedescription')
  const out = (msg || text).trim().replace(/\s+/g, ' ').slice(0, 300)
  return out
}

function brief(text: string): string {
  const t = davMessage(text)
  return t ? `：${t}` : ''
}
