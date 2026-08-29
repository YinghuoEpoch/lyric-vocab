import { useState } from 'react'
import { Check, Loader2 } from 'lucide-react'
import {
  PROVIDERS,
  findProvider,
  loadConfig,
  missingField,
  normalizeBaseUrl,
  saveConfig,
  testConfig,
  type AiConfig
} from '../enrich'
import { Eye, EyeOff } from 'lucide-react'

/**
 * AI 设置面板（选供应商、填 Key / 地址 / 模型、测试连接）。
 *
 * 抽成独立组件是因为**两个功能都要用同一份配置**：一键填充、一键划词。
 * 从前它长在「一键填充」弹窗里，划词那边只能把用户甩到填充弹窗去 ——
 * 点了「AI 设置」结果弹窗内容变成了填充，逻辑明显不对。
 */

type TestState =
  | { phase: 'idle' }
  | { phase: 'running' }
  | { phase: 'ok'; sample: string }
  | { phase: 'fail'; message: string }

const inputClass =
  'w-full h-9 px-2 text-sm rounded-lg border border-paper-border bg-stone-50/80 text-ink placeholder-ink-muted focus:outline-none focus:ring-1 focus:ring-amber-500/40 focus:border-amber-500'

interface AiSettingsPanelProps {
  /** 保存成功后回调。上层据此决定是回到自己那屏还是关掉 */
  onSaved: (config: AiConfig) => void
  /** 已经配好过时才给「取消」—— 头一回进来没有可回去的地方 */
  onCancel?: () => void
}

export function AiSettingsPanel({ onSaved, onCancel }: AiSettingsPanelProps) {
  /**
   * 配置**在初始化时当场读出来**，不能先给一份空的等 effect 再填：
   * 那样第一次打开会先按「还没设过 AI」渲染一帧，密码框一闪而过 ——
   * 手机上足够把安全键盘叫出来，而框随即消失，键盘就再也关不掉了。
   */
  const [draft, setDraft] = useState<AiConfig>(loadConfig)
  const [test, setTest] = useState<TestState>({ phase: 'idle' })
  /** Key 是否明文显示。默认明文 —— 理由见下面输入框那处注释 */
  const [showKey, setShowKey] = useState(true)

  const preset = findProvider(draft.providerId)
  const draftKey = draft.keys[preset.id] ?? ''
  const missing = missingField(draft)

  /** 改配置就把上一次的测试结果作废，免得看着旧的「已连通」以为还算数 */
  const patch = (change: Partial<AiConfig>) => {
    setDraft((d) => ({ ...d, ...change }))
    setTest({ phase: 'idle' })
  }

  const pickProvider = (id: string) => patch({ providerId: id })

  const setKey = (value: string) => patch({ keys: { ...draft.keys, [preset.id]: value } })

  const handleTest = async () => {
    setTest({ phase: 'running' })
    try {
      const sample = await testConfig(draft)
      setTest({ phase: 'ok', sample })
    } catch (err) {
      setTest({ phase: 'fail', message: err instanceof Error ? err.message : String(err) })
    }
  }

  const handleSave = () => {
    // 存之前把地址规整一遍（补 https://、去掉多余的尾巴），
    // 用户下次打开看到的就是最终生效的那一份，不用猜自己填的到底算不算数
    const cleaned: AiConfig = {
      ...draft,
      baseUrl: normalizeBaseUrl(draft.baseUrl),
      model: draft.model.trim(),
      keys: Object.fromEntries(Object.entries(draft.keys).map(([id, key]) => [id, key.trim()]))
    }
    saveConfig(cleaned)
    onSaved(cleaned)
  }

  return (
    <>
        <p className="text-xs text-ink-muted leading-relaxed">
          填充和划词都由 AI 完成，需要你自己的 API Key。
          Key 只保存在这台手机上，不会上传，也不会写进导出的备份文件。
        </p>

        <div className="flex gap-1.5">
          {PROVIDERS.map((p) => (
            <button
              key={p.id}
              type="button"
              onClick={() => pickProvider(p.id)}
              className={
                'flex-1 h-8 rounded-lg text-sm border ' +
                (p.id === draft.providerId
                  ? 'border-amber-500 bg-amber-50 text-amber-800 font-medium'
                  : 'border-paper-border text-ink-muted hover:bg-stone-50')
              }
            >
              {p.name}
            </button>
          ))}
        </div>

        {preset.editable && (
          <div className="space-y-2">
            <input
              type="url"
              inputMode="url"
              autoCapitalize="off"
              autoCorrect="off"
              value={draft.baseUrl}
              onChange={(e) => patch({ baseUrl: e.target.value })}
              placeholder="服务地址"
              className={inputClass}
            />
            <input
              type="text"
              autoCapitalize="off"
              autoCorrect="off"
              value={draft.model}
              onChange={(e) => patch({ model: e.target.value })}
              placeholder="模型名"
              className={inputClass}
            />
          </div>
        )}

        {/*
          Key 这一格默认**明文**，右边一枚眼睛可以遮起来。
          两个原因：
          - 安卓 WebView 对密码框常常不给「粘贴」菜单，而这格永远是靠粘贴填的
          - Key 是一长串，粘成一串圆点的话粘错、粘漏都看不出来，
            只能等填充跑起来报错才知道
          自己的手机、自己的 Key，明文没什么可藏的；真要遮就点那枚眼睛。
        */}
        <div className="relative">
          <input
            type={showKey ? 'text' : 'password'}
            autoCapitalize="off"
            autoCorrect="off"
            autoComplete="off"
            spellCheck={false}
            value={draftKey}
            onChange={(e) => setKey(e.target.value)}
            placeholder={preset.editable ? '粘贴 API Key' : `粘贴 ${preset.name} 的 API Key`}
            className={`${inputClass} pr-9`}
          />
          <button
            type="button"
            onClick={() => setShowKey((v) => !v)}
            className="absolute inset-y-0 right-0 w-9 flex items-center justify-center text-ink-muted rounded-lg hover:bg-stone-100"
            aria-label={showKey ? '遮住 Key' : '显示 Key'}
            title={showKey ? '遮住 Key' : '显示 Key'}
          >
            {showKey ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
          </button>
        </div>

        {/* 提示与示例挨在一起，中间不留空行：它们是同一句话的两半 */}
        <div className="space-y-0.5 text-xs text-ink-muted leading-relaxed break-words">
          <p>{preset.hint}</p>
          {preset.examples?.map((line) => (
            <p key={line}>{line}</p>
          ))}
        </div>

        {test.phase === 'ok' && (
          <p className="text-sm text-emerald-700 flex items-start gap-1.5">
            <Check className="w-4 h-4 mt-0.5 shrink-0" />
            <span>
              连通了。试填 stood：
              <span className="text-ink">{test.sample}</span>
            </span>
          </p>
        )}
        {test.phase === 'fail' && (
          <p className="text-sm text-red-600 leading-relaxed break-words">{test.message}</p>
        )}

        <div className="flex gap-2 pt-1">
          {onCancel && (
            <button
              type="button"
              className="h-9 px-3 rounded-lg border border-stone-300 text-stone-600 text-sm hover:bg-stone-50"
              onClick={onCancel}
            >
              取消
            </button>
          )}
          <button
            type="button"
            disabled={!!missing || test.phase === 'running'}
            className="h-9 px-3 rounded-lg border border-stone-300 text-stone-600 text-sm hover:bg-stone-50 disabled:opacity-40 flex items-center gap-1.5"
            onClick={handleTest}
          >
            {test.phase === 'running' && <Loader2 className="w-3.5 h-3.5 animate-spin" />}
            测试连接
          </button>
          <button
            type="button"
            disabled={!!missing}
            className="flex-1 h-9 rounded-lg bg-amber-600 hover:bg-amber-700 disabled:opacity-40 text-white text-sm font-medium"
            onClick={handleSave}
          >
            保存
          </button>
        </div>

        {missing && (
          <p className="text-xs text-ink-muted">
            还差
            {missing === 'key' ? ' API Key' : missing === 'baseUrl' ? '服务地址' : '模型名'}
            没填
          </p>
        )}
    </>
  )
}
