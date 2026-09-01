import { Capacitor, CapacitorHttp } from '@capacitor/core'

/**
 * 把录音的字节取回来（为了存下来，不是为了当场播）。
 *
 * **为什么不能直接用 fetch**：词典那个地址不带跨域许可，网页里 fetch 会被拦下来
 * （浏览器里试过，报 Failed to fetch）。所以：
 *
 * - **手机上**走 Capacitor 的原生网络，请求是安卓那边发的，压根不经过浏览器那套规矩
 * - **电脑浏览器里**走 vite 的开发转发（vite.config.ts 里那条 /dictvoice），
 *   只是为了开发时能把缓存这段验一验，跟打包出去的 App 无关
 *
 * 播放本身不受这条限制 —— audio 标签放外站的声音一直是允许的，
 * 所以取字节失败时还有「直接流着播」这条老路兜着（见 dictAudio.ts）。
 */

/** 取不到录音（词典里没这个词条）—— 和「网络不通」不是一回事，上层要分开处理 */
export class NoRecording extends Error {}

/**
 * 拿回来的到底是不是 mp3。
 *
 * **光看状态码不够。** 开发转发没配好的时候，`/dictvoice` 被当成前端路由，
 * 返回的是 App 自己的首页 HTML —— 状态码 200，我们照单全收，
 * 于是**把网页当录音存进了缓存**，而且缓存不过期，一存就是永久的哑巴。
 * 真机上同样有得撞：网络劫持、公共 WiFi 的登录页、运营商插页，都是 200 的 HTML。
 *
 * 所以只认 mp3 自己的开头：ID3 标签，或者 MPEG 的帧同步（0xFF 后三位全 1）。
 * 认不出来就当没有这个录音 —— 宁可退回机器音，也不能把垃圾存下来。
 */
export function looksLikeMp3(bytes: ArrayBuffer): boolean {
  const head = new Uint8Array(bytes)
  if (head.length < 4) return false
  // "ID3"
  if (head[0] === 0x49 && head[1] === 0x44 && head[2] === 0x33) return true
  // 帧同步：11 个 1
  return head[0] === 0xff && (head[1] & 0xe0) === 0xe0
}

function base64ToArrayBuffer(base64: string): ArrayBuffer {
  const binary = atob(base64)
  const bytes = new Uint8Array(binary.length)
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i)
  return bytes.buffer
}

export async function fetchAudioBytes(url: string): Promise<ArrayBuffer> {
  if (Capacitor.isNativePlatform()) {
    const res = await CapacitorHttp.get({ url, responseType: 'blob', connectTimeout: 8000 })
    // 词典没有这个词条时返回的是一段 json 错误，不是音频
    if (res.status < 200 || res.status >= 300) throw new NoRecording(String(res.status))
    const data = res.data
    const bytes =
      typeof data === 'string'
        ? base64ToArrayBuffer(data)
        : data instanceof ArrayBuffer
          ? data
          : null
    if (!bytes) throw new Error('拿回来的不是音频')
    return checked(bytes)
  }

  const res = await fetch(url)
  if (!res.ok) throw new NoRecording(String(res.status))
  return checked(await res.arrayBuffer())
}

/** 不是 mp3 就当没有这个录音，绝不往缓存里放 */
function checked(bytes: ArrayBuffer): ArrayBuffer {
  if (!looksLikeMp3(bytes)) throw new NoRecording('拿回来的不是音频')
  return bytes
}
