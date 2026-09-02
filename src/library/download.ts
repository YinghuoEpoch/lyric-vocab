import { Capacitor, CapacitorHttp } from '@capacitor/core'
import type { CatalogBook } from './catalog'

/**
 * 从古登堡把一本书的 epub 取回来。
 *
 * 走的是和取真人发音（`src/speech/fetchAudio.ts`）同一条路，原因也一样：
 * 古登堡不带跨域许可（验过，响应里一个 `Access-Control-*` 头都没有），
 * 网页里直接 fetch 会被拦下来。所以
 *
 * - **手机上**走 Capacitor 的原生网络，请求由安卓发出，不受浏览器那套规矩管
 * - **电脑浏览器里**走 vite 的开发转发（vite.config.ts 里那条 `/gutenberg/`），
 *   只为开发时能把整条流程验一验，跟打包出去的 App 无关
 *
 * ## ⚠️ 为什么要分块下载（2026-09-02 真机上栽了才改的）
 *
 * 第一版是一个请求整本下完。手机上（4G/5G）**每一本都失败**，报
 * `unexpected end of stream on com.android.okhttp.Address@…` ——
 * 连接建起来了，传到一半被掐断。
 *
 * 查过不是编码的问题：响应头很干净，有 `content-length`、不分块、不压缩。
 * 就是这条长连接活不到传完。
 *
 * 好在古登堡三个源都支持分段取（`accept-ranges: bytes`，实测都回 206）。
 * 所以改成**一次只要一小段**：每段几百 KB，请求短、连接活得久，
 * 掐断了也只重试那一段而不是整本重来。顺带还能报进度。
 */

/** 一次要多大。太小则请求次数多得离谱，太大又回到「长连接活不下来」的老问题 */
const CHUNK = 256 * 1024
/** 单段失败重试几次 */
const RETRIES = 3
/** 整本最多允许多少段，防止服务器给了个离谱的长度把 App 卡死 */
const MAX_CHUNKS = 400

/**
 * 备用源。主站不通时依次往下试。都实测过：同一本书返回的字节数完全一致，
 * 且都支持分段取。（另有 `gutenberg.nabasny.com` 也能连，但同一本书大小对不上，
 * 内容版本不一样，故意不用。）
 *
 * ⚠️ **一律用 https，不能有 http。**
 *
 * 安卓从 9 开始默认禁止明文流量，真机上直接报
 * `Cleartext HTTP traffic to xxx not permitted`，一个字节都取不到。
 * 第一版这里放了 `http://aleph.gutenberg.org` 和 `http://gutenberg.net.au`，
 * 澳洲站因此**每一本都下不了**（用户报的）。
 *
 * `aleph.gutenberg.org` 只有 http（试过 https，连不上），
 * 所以它在安卓上永远用不了，直接去掉 —— 留着只会白白多等一轮超时。
 */
export const US_HOSTS = ['https://www.gutenberg.org', 'https://gutenberg.pglaf.org']

/** 澳洲站只有这一处，没有镜像。它支持 https，验过同一本书字节数一致 */
export const AUS_HOSTS = ['https://gutenberg.net.au']

/**
 * 美国站的路径直接用 `/cache/epub/{id}/pg{id}.epub`，不用会 302 跳转的
 * `/ebooks/{id}.epub.noimages`。少一次跳转就少依赖一层
 * 「原生网络跟不跟随重定向」的行为 —— 这类跨平台差异正是这个项目栽过跟头的地方。
 * 抽查过 16 本（编号 1 到 70000），这个规律全部成立。
 *
 * 澳洲站的地址没有规律可循，所以目录里存的就是整条站内路径，这里直接用。
 */
function bookPath(book: CatalogBook): string {
  return book.source === 'a' ? `/${book.ref}` : `/cache/epub/${book.ref}/pg${book.ref}.epub`
}

function hostsFor(book: CatalogBook): string[] {
  return book.source === 'a' ? AUS_HOSTS : US_HOSTS
}

/** 开发时走 vite 转发；两个站各配了一条 */
function devPrefix(book: CatalogBook): string {
  return book.source === 'a' ? '/gutenberg-au' : '/gutenberg'
}

/** 这本书下下来是什么格式 —— 决定怎么校验、包成什么文件名 */
function formatOf(book: CatalogBook): 'epub' | 'txt' {
  return book.source === 'a' ? 'txt' : 'epub'
}

/** 这本书取不到 —— 和「网络不通」不是一回事，上层要分开提示 */
export class NoEpub extends Error {}

function base64ToBytes(base64: string): Uint8Array {
  const binary = atob(base64)
  const out = new Uint8Array(binary.length)
  for (let i = 0; i < binary.length; i++) out[i] = binary.charCodeAt(i)
  return out
}

/**
 * 拿回来的到底是不是 epub。
 *
 * **光看状态码不够** —— 这条教训是取发音时用真金白银换来的：开发转发没配对时
 * 返回的是 App 自己的首页 HTML，状态码照样 200，结果把网页当录音存了进去。
 * 真机上同样有得撞：公共 WiFi 的登录页、运营商插页，全是 200 的 HTML。
 *
 * epub 本质是个 zip，头四个字节固定是 `PK\x03\x04`。
 */
export function looksLikeEpub(bytes: ArrayBuffer | Uint8Array): boolean {
  const head = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes)
  if (head.length < 4) return false
  return head[0] === 0x50 && head[1] === 0x4b && head[2] === 0x03 && head[3] === 0x04
}

/**
 * 澳洲站给的是纯文本，没有 epub 那种一眼认得出的文件头。
 *
 * 但要防的东西是一样的：**别把一段 HTML 当成书收下来**（运营商插页、
 * 公共 WiFi 登录页、站点自己的错误页，全是 200 的 HTML）。
 * 所以反过来查 —— 开头像网页就不要。
 */
export function looksLikeText(bytes: ArrayBuffer | Uint8Array): boolean {
  const head = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes)
  if (head.length < 16) return false
  // 只看开头一小段，够判断了
  let s = ''
  for (let i = 0; i < Math.min(head.length, 400); i++) s += String.fromCharCode(head[i])
  if (/^\s*(<!doctype|<html|<\?xml|<head|<body)/i.test(s)) return false
  // 纯文本里不该出现 0 字节
  return !head.slice(0, 400).includes(0)
}

function looksRight(bytes: ArrayBuffer | Uint8Array, format: 'epub' | 'txt'): boolean {
  return format === 'epub' ? looksLikeEpub(bytes) : looksLikeText(bytes)
}

/** 一段的返回：字节，以及服务器说的整个文件有多大 */
interface Chunk {
  bytes: Uint8Array
  /** 从 `Content-Range: bytes 0-255/1234` 里那个总长；解析不出来就是 null */
  total: number | null
}

export function parseTotal(headers: Record<string, string> | undefined): number | null {
  if (!headers) return null
  // 头的大小写不保证，挨个找
  const key = Object.keys(headers).find((k) => k.toLowerCase() === 'content-range')
  const m = key ? /\/(\d+)\s*$/.exec(headers[key]) : null
  return m ? Number(m[1]) : null
}

/** 取一段。`end` 含在内，和 HTTP 的 Range 一致 */
async function fetchRange(url: string, start: number, end: number): Promise<Chunk> {
  const range = `bytes=${start}-${end}`

  if (Capacitor.isNativePlatform()) {
    const res = await CapacitorHttp.get({
      url,
      headers: { Range: range },
      responseType: 'blob',
      connectTimeout: 15000,
      readTimeout: 20000
    })
    // 206 是「给你这一段」，200 是「不认 Range，整个给你」—— 后者也能用
    if (res.status !== 206 && res.status !== 200) throw new NoEpub(String(res.status))
    const data = res.data
    const bytes =
      typeof data === 'string'
        ? base64ToBytes(data)
        : data instanceof ArrayBuffer
          ? new Uint8Array(data)
          : null
    if (!bytes) throw new Error('拿回来的不是文件')
    return { bytes, total: parseTotal(res.headers as Record<string, string>) }
  }

  const res = await fetch(url, { headers: { Range: range } })
  if (res.status !== 206 && res.status !== 200) throw new NoEpub(String(res.status))
  const total = parseTotal({ 'content-range': res.headers.get('content-range') ?? '' })
  return { bytes: new Uint8Array(await res.arrayBuffer()), total }
}

/** 同一段重试几次再放弃。掐断是随机的，重试往往就过去了 */
async function fetchRangeWithRetry(url: string, start: number, end: number): Promise<Chunk> {
  let last: unknown
  for (let i = 0; i < RETRIES; i++) {
    try {
      return await fetchRange(url, start, end)
    } catch (e) {
      last = e
      // 立刻重试多半还是撞在同一个点上，稍微等一下
      if (i < RETRIES - 1) await new Promise((r) => setTimeout(r, 400 * (i + 1)))
    }
  }
  throw last
}

export interface DownloadProgress {
  /** 已经拿到多少字节 */
  loaded: number
  /** 一共多大；服务器没说就是 null */
  total: number | null
}

/**
 * 把一本书整个取回来。分段取，主站不行就换备用源。
 *
 * @param onProgress 每取到一段回调一次，用来显示进度
 */
export async function fetchBook(
  book: CatalogBook,
  onProgress?: (p: DownloadProgress) => void
): Promise<ArrayBuffer> {
  const path = bookPath(book)
  const format = formatOf(book)
  let lastError: unknown

  for (const host of hostsFor(book)) {
    // 浏览器里走开发转发，只试第一条 —— 转发规则每个站只配了一个
    const base = Capacitor.isNativePlatform() ? host + path : devPrefix(book) + path
    try {
      return await downloadFrom(base, format, onProgress)
    } catch (e) {
      lastError = e
      if (!Capacitor.isNativePlatform()) break
    }
  }
  throw lastError ?? new Error('下载失败')
}

async function downloadFrom(
  url: string,
  format: 'epub' | 'txt',
  onProgress?: (p: DownloadProgress) => void
): Promise<ArrayBuffer> {
  const parts: Uint8Array[] = []
  let loaded = 0
  let total: number | null = null

  for (let n = 0; n < MAX_CHUNKS; n++) {
    const chunk = await fetchRangeWithRetry(url, loaded, loaded + CHUNK - 1)

    // 第一段就要认出对不对，是 HTML 的话趁早停，别白下几百 KB
    if (n === 0 && !looksRight(chunk.bytes, format)) throw new NoEpub('拿回来的不是书')

    if (chunk.total !== null) total = chunk.total
    if (chunk.bytes.length === 0) break

    parts.push(chunk.bytes)
    loaded += chunk.bytes.length
    onProgress?.({ loaded, total })

    // 服务器不认 Range，一次就把整本给了 —— 那就已经下完了
    if (total === null && chunk.bytes.length < CHUNK) break
    if (total !== null && loaded >= total) break
  }

  const out = new Uint8Array(loaded)
  let at = 0
  for (const p of parts) {
    out.set(p, at)
    at += p.length
  }
  if (!looksRight(out, format)) throw new NoEpub('拿回来的不是书')
  return out.buffer
}

/**
 * 把下载到的字节包成一个 File，好让它走**完全相同**的导入流程。
 *
 * 这样「从书库下载」和「从手机里选文件」在导入层眼里没有区别 ——
 * 章节切分、编码处理、异常提示全都是现成的，一行都不用另写。
 */
export function asBookFile(bytes: ArrayBuffer, book: CatalogBook): File {
  // 文件名只是给导入器取默认书名用的，去掉路径符号免得节外生枝
  const safe = book.title.replace(/[\\/:*?"<>|]/g, ' ').trim() || 'book'
  return formatOf(book) === 'txt'
    ? new File([bytes], `${safe}.txt`, { type: 'text/plain' })
    : new File([bytes], `${safe}.epub`, { type: 'application/epub+zip' })
}
