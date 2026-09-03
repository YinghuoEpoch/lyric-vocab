import { gzipSync, gunzipSync, strFromU8, strToU8 } from 'fflate'

/**
 * 同步文件的装箱／拆箱。
 *
 * ## 为什么要压
 *
 * 用户问「这么高频率的同步会不会很快用完额度」—— 会，而且他那份数据不小：
 * 书库里是整本整本的小说，一份 JSON 好几兆。坚果云免费账户每月 1G 上传，
 * 一次传五兆的话，两百次就没了 —— 而自动同步一天就能传十几次。
 *
 * 正文是英文散文，**gzip 压得极狠**（这类文本通常小一个数量级）。
 * 代价是 base64 会再涨三分之一（下面说为什么必须 base64），净下来还是省好几倍。
 *
 * ## 为什么压完还要 base64
 *
 * 手机上走的是 Capacitor 的原生网络，**请求体只能是字符串**，塞不进原始字节。
 * 所以压完转成 base64 再当文本发出去。多出来的三分之一是这条路的过路费。
 *
 * ## 老文件还得认
 *
 * 用户云端已经有一份没压过的（明文 JSON）。**不能因为换了格式就读不出来** ——
 * 那等于把他已经同步上去的东西弄丢。所以拆箱时两种都认：
 * 以 `{` 开头就是老的明文，否则按 base64 + gzip 处理。
 */

/** 大数组不能一次 apply，会爆栈。分块转 */
function bytesToBase64(bytes: Uint8Array): string {
  let binary = ''
  const CHUNK = 0x8000
  for (let i = 0; i < bytes.length; i += CHUNK) {
    binary += String.fromCharCode(...bytes.subarray(i, i + CHUNK))
  }
  return btoa(binary)
}

function base64ToBytes(b64: string): Uint8Array {
  const binary = atob(b64.trim())
  const out = new Uint8Array(binary.length)
  for (let i = 0; i < binary.length; i++) out[i] = binary.charCodeAt(i)
  return out
}

/** 装箱：一段 JSON 文本 -> 实际要传上去的那串字符 */
export function pack(json: string): string {
  return bytesToBase64(gzipSync(strToU8(json)))
}

/**
 * 拆箱：把云端那串字符变回 JSON 文本。
 *
 * ⚠️ 两种都要认 —— 明文（换格式之前传上去的）和压缩过的。
 * 少了前者，用户已经同步上去的数据就读不出来了。
 */
export function unpack(text: string): string {
  const t = text.trim()
  if (t.startsWith('{')) return t
  return strFromU8(gunzipSync(base64ToBytes(t)))
}

/** 压完有多大（字节）。给界面显示「这一次传了多少」用 */
export function packedSize(packed: string): number {
  return packed.length
}

/** 人看的体积 */
export function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`
}
