import { Capacitor, CapacitorHttp } from '@capacitor/core'

/**
 * 从古登堡把一本书的 epub 取回来。
 *
 * 走的是和取真人发音（`src/speech/fetchAudio.ts`）同一条路，原因也一样：
 * 古登堡不带跨域许可，网页里直接 fetch 会被拦下来。所以
 *
 * - **手机上**走 Capacitor 的原生网络，请求由安卓发出，不受浏览器那套规矩管
 * - **电脑浏览器里**走 vite 的开发转发（vite.config.ts 里那条 `/gutenberg`），
 *   只为开发时能把整条流程验一验，跟打包出去的 App 无关
 *
 * 取回来的字节喂给现成的 epub 导入器，所以「下载」和「解析」是两件独立的事，
 * 这里只管把字节弄回来。
 */

/**
 * 下载地址直接用 `/cache/epub/{id}/pg{id}.epub`，不用 `/ebooks/{id}.epub.noimages`。
 *
 * 后者会 302 跳到前者。少一次跳转就少依赖一层「原生网络跟不跟随重定向」的行为 ——
 * 这类跨平台差异正是这个项目栽过跟头的地方。抽查过 16 本（最老的编号 1 到最新的
 * 70000），这个规律全部成立。
 */
function epubUrl(id: number): string {
  return Capacitor.isNativePlatform()
    ? `https://www.gutenberg.org/cache/epub/${id}/pg${id}.epub`
    : `/gutenberg/cache/epub/${id}/pg${id}.epub`
}

/** 这本书古登堡没有 epub —— 和「网络不通」不是一回事，上层要分开提示 */
export class NoEpub extends Error {}

function base64ToArrayBuffer(base64: string): ArrayBuffer {
  const binary = atob(base64)
  const bytes = new Uint8Array(binary.length)
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i)
  return bytes.buffer
}

/**
 * 拿回来的到底是不是 epub。
 *
 * **光看状态码不够** —— 这条教训是取发音时用真金白银换来的：开发转发没配对时
 * 返回的是 App 自己的首页 HTML，状态码照样 200，结果把网页当录音存了进去。
 * 真机上同样有得撞：公共 WiFi 的登录页、运营商插页，全是 200 的 HTML。
 *
 * epub 本质是个 zip，头四个字节固定是 `PK\x03\x04`。认不出来就当没有这本书，
 * 免得把一段 HTML 送进解析器，报出一堆看不懂的错。
 */
function looksLikeEpub(bytes: ArrayBuffer): boolean {
  const head = new Uint8Array(bytes)
  if (head.length < 4) return false
  return head[0] === 0x50 && head[1] === 0x4b && head[2] === 0x03 && head[3] === 0x04
}

export async function fetchBookEpub(id: number): Promise<ArrayBuffer> {
  const url = epubUrl(id)

  if (Capacitor.isNativePlatform()) {
    const res = await CapacitorHttp.get({ url, responseType: 'blob', connectTimeout: 15000 })
    if (res.status < 200 || res.status >= 300) throw new NoEpub(String(res.status))
    const data = res.data
    const bytes =
      typeof data === 'string'
        ? base64ToArrayBuffer(data)
        : data instanceof ArrayBuffer
          ? data
          : null
    if (!bytes) throw new Error('拿回来的不是文件')
    return checked(bytes)
  }

  const res = await fetch(url)
  if (!res.ok) throw new NoEpub(String(res.status))
  return checked(await res.arrayBuffer())
}

function checked(bytes: ArrayBuffer): ArrayBuffer {
  if (!looksLikeEpub(bytes)) throw new NoEpub('拿回来的不是 epub')
  return bytes
}

/**
 * 把下载到的字节包成一个 File，好让它走**完全相同**的导入流程。
 *
 * 这样「从书库下载」和「从手机里选文件」在导入层眼里没有区别 ——
 * 章节切分、编码处理、异常提示全都是现成的，一行都不用另写。
 */
export function asEpubFile(bytes: ArrayBuffer, title: string): File {
  // 文件名只是给导入器取默认书名用的，去掉路径符号免得节外生枝
  const safe = title.replace(/[\\/:*?"<>|]/g, ' ').trim() || 'book'
  return new File([bytes], `${safe}.epub`, { type: 'application/epub+zip' })
}

export { looksLikeEpub }
