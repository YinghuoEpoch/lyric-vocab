import { Capacitor, CapacitorHttp } from '@capacitor/core'

/**
 * 云端语音合成（火山引擎 / 豆包语音）。
 *
 * **为什么要这条路**（后续规划.md 第五十七节）：用户的鸿蒙平板用卓易通跑这个 app，
 * 那层兼容环境里一个系统朗读引擎都没有，凡是过机器音的一概没声音。
 * 装引擎、换设备都试过了，走不通 —— 只能换成一条不依赖设备的路。
 *
 * **用户定的优先级**：真人录音 → 云端合成 → 系统引擎（实在没网了才用）。
 * 手机平板一套逻辑，不做区分（他的原话：「不用平板手机区分开」）。
 * 真人录音仍排第一：那是人念的，比任何合成都好，而且不花调用次数。
 *
 * ## 为什么是「按次数」那个服务
 *
 * 用户开了火山的两个语音合成，免费额度一个是 **20000 次调用**、一个是 **20000 个字**。
 * 他读的是英文句子，一句几十个字符 —— 按字数扣半个多月就没了，
 * 按次数扣不管句子多长都算一次，同样的额度能用近两年。差着四十倍，所以用前者。
 */

/** 火山那边「成功」的暗号。别的都是错，message 里有人话 */
const OK_CODE = 3000

export interface CloudTtsConfig {
  /** 应用 ID */
  appid: string
  /** 访问令牌 */
  token: string
  /**
   * 音色。用户那个服务只给了两个（男声、女声），标的是中文，
   * 但他实测英文句子也念得出来 —— 到底填哪个由「开发者 → 朗读引擎参数」里试出来。
   */
  voiceType: string
  /** 服务集群。控制台上「服务集群」那一行写的就是它 */
  cluster: string
}

/**
 * 默认值。
 *
 * `volcano_tts` 是用户控制台上「语音合成」那一栏明明白白写着的集群名。
 * 音色默认填通用女声，**填错了不会静默失败** —— 开发者那一屏的「云端试读」
 * 会把火山返回的原话打在屏上，一眼看得出是音色不对还是别的。
 */
export function defaultCloudConfig(): CloudTtsConfig {
  return { appid: '', token: '', voiceType: 'BV001_streaming', cluster: 'volcano_tts' }
}

const STORAGE_KEY = 'lyric-vocab-cloud-tts'

/** 配全了没有。没配全就当这条路不存在，直接落到系统引擎，不打扰用户 */
export function isCloudReady(c: CloudTtsConfig): boolean {
  return c.appid.trim() !== '' && c.token.trim() !== '' && c.voiceType.trim() !== ''
}

export function loadCloudConfig(): CloudTtsConfig {
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    if (!raw) return defaultCloudConfig()
    const parsed = JSON.parse(raw)
    const d = defaultCloudConfig()
    const str = (v: unknown, fallback: string) => (typeof v === 'string' && v.trim() ? v.trim() : fallback)
    return {
      appid: str(parsed?.appid, d.appid),
      token: str(parsed?.token, d.token),
      voiceType: str(parsed?.voiceType, d.voiceType),
      cluster: str(parsed?.cluster, d.cluster)
    }
  } catch {
    return defaultCloudConfig()
  }
}

export function saveCloudConfig(c: CloudTtsConfig): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(c))
  } catch {
    /* 存不下就这一趟有效，不该拦着人用 */
  }
}

/** 云端这条路自己的错。带上原话，诊断屏直接显示它 */
export class CloudTtsError extends Error {}

/** 没配 key —— 不是错，是「这条路没开」。上层据此安静地往下走 */
export class CloudNotConfigured extends Error {}

/**
 * 请求体。
 *
 * **reqid 每次都要新的**（火山文档明写的），所以由外面传进来，这里不自己生成 ——
 * 生成随机数的函数没法测，把它挡在外面这一整段就是纯的了。
 */
export function buildTtsBody(c: CloudTtsConfig, text: string, reqid: string) {
  return {
    app: { appid: c.appid, token: c.token, cluster: c.cluster },
    user: { uid: 'lyric-vocab' },
    audio: {
      voice_type: c.voiceType,
      encoding: 'mp3',
      // 速度、音量、音高都用默认。单词读慢一点那件事交给系统引擎那条路，
      // 云端这边一句话里语速忽快忽慢反而怪
      speed_ratio: 1.0
    },
    request: { reqid, text, operation: 'query' }
  }
}

/**
 * 认证头。
 *
 * ⚠️ **是分号，不是空格** —— `Bearer;<token>`。火山文档特意强调过这一点，
 * 按常规写成 `Bearer <token>` 会被拒，而报错未必说得清是这个原因。
 */
export function authHeader(token: string): string {
  return `Bearer;${token}`
}

/**
 * 从回包里把音频取出来。
 *
 * 火山**用 HTTP 200 回错误**：包里 code 不是 3000 才是真相。
 * 所以这里只认 code 和 data，不看状态码 —— 这个项目在别处栽过同一件事
 * （见 fetchAudio.ts：光看状态码把一张网页当录音存进了缓存）。
 */
export function pickAudioBase64(payload: unknown): string {
  if (!payload || typeof payload !== 'object') {
    throw new CloudTtsError('回包不是 JSON，多半是被网络劫持了')
  }
  const o = payload as Record<string, unknown>
  const code = typeof o.code === 'number' ? o.code : undefined
  const message = typeof o.message === 'string' ? o.message : ''
  if (code !== undefined && code !== OK_CODE) {
    throw new CloudTtsError(`火山返回 ${code}${message ? `：${message}` : ''}`)
  }
  const data = o.data
  if (typeof data !== 'string' || !data) {
    throw new CloudTtsError(message ? `没有音频：${message}` : '没有音频，回包里 data 是空的')
  }
  return data
}

export function base64ToArrayBuffer(base64: string): ArrayBuffer {
  const binary = atob(base64)
  const bytes = new Uint8Array(binary.length)
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i)
  return bytes.buffer
}

/**
 * 请求地址。
 *
 * **手机上直接打火山**（走 Capacitor 的原生网络，安卓发的请求，没有跨域这回事）；
 * **电脑浏览器里走 vite 的转发**（`/volctts`，见 vite.config.ts）——
 * 只为开发时能把这一段验一验，跟打包出去的 App 无关。和取词典发音是同一套办法。
 */
const NATIVE_URL = 'https://openspeech.bytedance.com/api/v1/tts'
const DEV_URL = '/volctts/api/v1/tts'

/** 合成一段文字，拿回 mp3 的字节 */
export async function synthesizeCloud(
  c: CloudTtsConfig,
  text: string,
  reqid: string
): Promise<ArrayBuffer> {
  if (!isCloudReady(c)) throw new CloudNotConfigured('还没填云端朗读的 Key')
  const body = buildTtsBody(c, text, reqid)
  const headers = { 'Content-Type': 'application/json', Authorization: authHeader(c.token) }

  if (Capacitor.isNativePlatform()) {
    const res = await CapacitorHttp.post({
      url: NATIVE_URL,
      headers,
      data: body,
      connectTimeout: 10000,
      readTimeout: 15000
    })
    return base64ToArrayBuffer(readPayload(res.status, res.data))
  }

  const res = await fetch(DEV_URL, { method: 'POST', headers, body: JSON.stringify(body) })
  return base64ToArrayBuffer(readPayload(res.status, await res.text()))
}

/**
 * 状态码不好看时，**先看正文再报错**。
 *
 * ⚠️ 这一段是实测逼出来的：拿一个假令牌去问，火山回的是 HTTP 401，
 * 而正文里写着 `code 3001, "load grant: requested grant not found in SaaS storage"` ——
 * 那句才是能拿去查的东西。只报「网络返回 401」等于把唯一的线索扔了，
 * 而这一整条路的验证全靠用户把这句话念给我听（我手上没有他的 Key）。
 */
export function readPayload(status: number, raw: unknown): string {
  const payload = typeof raw === 'string' ? tryParse(raw) : raw
  // 正文能读懂就按正文说 —— 不管状态码是 200 还是 401
  if (payload && typeof payload === 'object') return pickAudioBase64(payload)
  if (status < 200 || status >= 300) {
    const text = typeof raw === 'string' ? raw.trim().slice(0, 160) : ''
    throw new CloudTtsError(`网络返回 ${status}${text ? `：${text}` : ''}`)
  }
  throw new CloudTtsError('回包不是 JSON，多半是被网络劫持了')
}

function tryParse(s: string): unknown {
  try {
    return JSON.parse(s)
  } catch {
    return null
  }
}

/** 每次请求一个新的 reqid。crypto 不在就退回时间加随机数 —— 这东西只要不重复就行 */
export function newReqId(): string {
  try {
    return crypto.randomUUID()
  } catch {
    return `${Date.now()}-${Math.random().toString(16).slice(2)}`
  }
}
