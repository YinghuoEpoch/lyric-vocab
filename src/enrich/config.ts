/**
 * 填充层的供应商配置。
 *
 * 这些 AI 服务几乎都提供「OpenAI 兼容」接口 —— 地址、认证方式、请求与返回的形状
 * 都一样，差别只有**服务地址**和**模型名**两样。所以这里不是一家一家写实现，
 * 而是把这两样从代码里挪出来变成配置：DeepSeek 是一个填好了的预设，
 * 「自定义」则让用户自己填，通义 / 智谱 / Kimi / OpenAI 之类都靠它接。
 *
 * Key 只存在这台手机的本地存储里，不会上传，也不会跟着「导出备份」走。
 */

export interface ProviderPreset {
  id: string
  /** 界面上显示的名字 */
  name: string
  /** 预设的服务地址；自定义时为空，由用户填 */
  baseUrl: string
  /** 预设的模型名；自定义时为空，由用户填 */
  model: string
  /** 是否由用户自己填地址与模型 */
  editable: boolean
  /** 界面上的一句提示：去哪儿拿 Key、地址该怎么填 */
  hint: string
  /**
   * 填法示例，显示在输入框下面的小字里，一行一样。
   * 不写进输入框的 placeholder：那里放不下（框内可显示约 257px，
   * 带 https:// 的完整网址要 264px），超出的部分会被切掉且没法滑动去看。
   */
  examples?: string[]
}

export const PROVIDERS: ProviderPreset[] = [
  {
    id: 'deepseek',
    name: 'DeepSeek',
    baseUrl: 'https://api.deepseek.com/v1',
    model: 'deepseek-chat',
    editable: false,
    hint: '在 platform.deepseek.com 注册后创建 API Key'
  },
  {
    id: 'custom',
    name: '自定义',
    baseUrl: '',
    model: '',
    editable: true,
    hint: '填服务商「OpenAI 兼容」接口的地址和模型名，例如：',
    // 带上 https://，否则看不出这是个网址（真填时不写也行，会自动补上）
    examples: ['地址 https://api.moonshot.cn/v1', '模型 moonshot-v1-8k']
  }
]

export const DEFAULT_PROVIDER_ID = 'deepseek'

export function findProvider(id: string): ProviderPreset {
  return PROVIDERS.find((p) => p.id === id) ?? PROVIDERS[0]
}

export interface AiConfig {
  providerId: string
  /** 自定义供应商的地址与模型；用预设时这两项不起作用 */
  baseUrl: string
  model: string
  /**
   * 每家的 Key 分开记。
   * 合成一个的话，切到另一家再切回来就得重新粘一遍。
   */
  keys: Record<string, string>
}

export function defaultConfig(): AiConfig {
  return { providerId: DEFAULT_PROVIDER_ID, baseUrl: '', model: '', keys: {} }
}

/**
 * 规整用户填的服务地址。
 *
 * 用户手上拿到的地址五花八门：有的带 `/chat/completions`，有的结尾多个斜杠，
 * 有的干脆不写 `https://`。都在这里抹平，免得因为一个斜杠就调不通还看不出为什么。
 */
export function normalizeBaseUrl(input: string): string {
  let url = input.trim()
  if (!url) return ''
  url = url.replace(/[?#].*$/, '')
  if (!/^https?:\/\//i.test(url)) url = `https://${url}`
  url = url.replace(/\/+$/, '')
  // 文档里给的常常是完整的调用地址，去掉尾巴才是「基地址」
  url = url.replace(/\/chat\/completions$/i, '')
  return url.replace(/\/+$/, '')
}

/** 拼出实际要调用的地址 */
export function chatEndpoint(baseUrl: string): string {
  return `${normalizeBaseUrl(baseUrl)}/chat/completions`
}

/** 一份配置最终解析出来的实际参数 */
export interface ResolvedProvider {
  name: string
  baseUrl: string
  model: string
  apiKey: string
}

/**
 * 把配置解析成可以直接用的参数；缺东西就返回 null。
 * 界面据此判断「还差点什么，先别让点开始」。
 */
export function resolveConfig(config: AiConfig): ResolvedProvider | null {
  const preset = findProvider(config.providerId)
  const baseUrl = normalizeBaseUrl(preset.editable ? config.baseUrl : preset.baseUrl)
  const model = (preset.editable ? config.model : preset.model).trim()
  const apiKey = (config.keys[preset.id] ?? '').trim()
  if (!baseUrl || !model || !apiKey) return null
  return { name: preset.name, baseUrl, model, apiKey }
}

/** 还差哪一样没填，用来在界面上直说 */
export function missingField(config: AiConfig): 'key' | 'baseUrl' | 'model' | null {
  const preset = findProvider(config.providerId)
  if (preset.editable && !normalizeBaseUrl(config.baseUrl)) return 'baseUrl'
  if (preset.editable && !config.model.trim()) return 'model'
  if (!(config.keys[preset.id] ?? '').trim()) return 'key'
  return null
}

const CONFIG_STORAGE = 'lyric-vocab-ai'
/** 旧版本只存一个 DeepSeek 的 Key，读到就认成 DeepSeek 的 */
const LEGACY_KEY_STORAGE = 'lyric-vocab-ai-key'

/**
 * 解析存下来的配置。写成纯函数是为了能单独测 —— 尤其是从旧版本升上来那条路。
 */
export function parseStoredConfig(raw: string | null, legacyKey: string | null): AiConfig {
  const config = defaultConfig()

  if (raw) {
    try {
      const parsed = JSON.parse(raw) as Partial<AiConfig>
      if (typeof parsed.providerId === 'string' && parsed.providerId) {
        // 认不出的 id（比如从更新的版本退回来）退回默认，不要留个空壳
        config.providerId = PROVIDERS.some((p) => p.id === parsed.providerId)
          ? parsed.providerId
          : DEFAULT_PROVIDER_ID
      }
      if (typeof parsed.baseUrl === 'string') config.baseUrl = parsed.baseUrl
      if (typeof parsed.model === 'string') config.model = parsed.model
      if (parsed.keys && typeof parsed.keys === 'object') {
        for (const [id, key] of Object.entries(parsed.keys)) {
          if (typeof key === 'string' && key.trim()) config.keys[id] = key.trim()
        }
      }
    } catch {
      // 存坏了就当没有，下次保存会覆盖掉
    }
  }

  // 老 Key 只在新配置还没有 DeepSeek 的 Key 时补进来，不覆盖用户后来填的
  const legacy = legacyKey?.trim()
  if (legacy && !config.keys[DEFAULT_PROVIDER_ID]) {
    config.keys[DEFAULT_PROVIDER_ID] = legacy
  }

  return config
}

export function loadConfig(): AiConfig {
  try {
    return parseStoredConfig(
      localStorage.getItem(CONFIG_STORAGE),
      localStorage.getItem(LEGACY_KEY_STORAGE)
    )
  } catch {
    return defaultConfig()
  }
}

export function saveConfig(config: AiConfig): void {
  try {
    localStorage.setItem(CONFIG_STORAGE, JSON.stringify(config))
    // 旧键留着：万一退回旧版本 APK，那边还认得这个 Key
    const key = config.keys[DEFAULT_PROVIDER_ID]
    if (key) localStorage.setItem(LEGACY_KEY_STORAGE, key)
  } catch {
    // 存不下就算了，这次会话内仍可使用
  }
}
