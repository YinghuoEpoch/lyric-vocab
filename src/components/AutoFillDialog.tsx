import { useEffect, useState } from 'react'
import { Sparkles, X, Check, Loader2 } from 'lucide-react'
import {
  PROVIDERS,
  findProvider,
  loadConfig,
  missingField,
  normalizeBaseUrl,
  resolveConfig,
  saveConfig,
  testConfig,
  type AiConfig
} from '../enrich'
import type { FillProgress } from '../enrich'
import { useBackHandler, BackPriority } from '../hooks/useBackHandler'

/**
 * 「一键填充」对话框。
 *
 * 第一次用会先要 AI 设置（用哪家、Key 是什么）—— 不做成设置页里的一项，
 * 是因为它只在这里用得上，放在用得到的地方最好找。
 */

export type FillPhase = 'idle' | 'running' | 'done' | 'error'

export interface AutoFillState {
  phase: FillPhase
  progress: FillProgress
  /** 出错或被中断时的说明 */
  message?: string
}

interface AutoFillDialogProps {
  open: boolean
  /** 待填充的数量（还有格子没填的笔记，不必整条空白） */
  pendingWords: number
  pendingPhrases: number
  pendingSentences: number
  /** 当前范围的名字，例如某个文库或某篇文档 */
  scopeName: string
  state: AutoFillState
  onStart: () => void
  onCancel: () => void
  onClose: () => void
}

type TestState =
  | { phase: 'idle' }
  | { phase: 'running' }
  | { phase: 'ok'; sample: string }
  | { phase: 'fail'; message: string }

const inputClass =
  'w-full h-9 px-2 text-sm rounded-lg border border-paper-border bg-stone-50/80 text-ink placeholder-ink-muted focus:outline-none focus:ring-1 focus:ring-amber-500/40 focus:border-amber-500'

export function AutoFillDialog({
  open,
  pendingWords,
  pendingPhrases,
  pendingSentences,
  scopeName,
  state,
  onStart,
  onCancel,
  onClose
}: AutoFillDialogProps) {
  /**
   * 编辑中的配置必须放进 state。
   * 直接在渲染时读 localStorage 的话，保存之后没有任何 state 变化，
   * 组件不会重渲染，界面就一直停在「请填 Key」那一屏。
   *
   * **初值必须当场读出来**，不能先给一份空配置等 effect 再填：
   * 那样第一次打开会先按「还没设过 AI」渲染一帧，密码输入框一闪而过 ——
   * 手机上足够让安全键盘弹出来，而框随即消失，键盘就再也关不掉了。
   */
  const [draft, setDraft] = useState<AiConfig>(loadConfig)
  const [saved, setSaved] = useState<AiConfig>(loadConfig)
  const [editing, setEditing] = useState(false)
  const [test, setTest] = useState<TestState>({ phase: 'idle' })

  const ready = resolveConfig(saved) !== null
  const needSetup = !ready || editing
  const running = state.phase === 'running'

  const preset = findProvider(draft.providerId)
  const draftKey = draft.keys[preset.id] ?? ''
  const missing = missingField(draft)
  /**
   * 「会发送给谁」显示什么名字。
   * 自定义时说「自定义」等于没说，显示实际的服务域名才看得出数据去了哪儿。
   */
  const savedTarget = (() => {
    const savedPreset = findProvider(saved.providerId)
    if (!savedPreset.editable) return savedPreset.name
    try {
      return new URL(normalizeBaseUrl(saved.baseUrl)).host
    } catch {
      return '你配置的 AI 服务'
    }
  })()

  useEffect(() => {
    if (open) {
      const current = loadConfig()
      setSaved(current)
      setDraft(current)
      setEditing(false)
      setTest({ phase: 'idle' })
    }
  }, [open])

  // 返回键：跑的时候先取消，闲着的时候直接关
  useBackHandler(open, BackPriority.orphanPrompt, () => (running ? onCancel() : onClose()))

  if (!open) return null

  const total = pendingWords + pendingPhrases + pendingSentences
  const percent =
    state.progress.total > 0 ? Math.round((state.progress.done / state.progress.total) * 100) : 0

  /** 改配置就把上一次的测试结果作废，免得看着旧的「已连通」以为还算数 */
  const patch = (change: Partial<AiConfig>) => {
    setDraft((d) => ({ ...d, ...change }))
    setTest({ phase: 'idle' })
  }

  const pickProvider = (id: string) => patch({ providerId: id })

  const setKey = (value: string) =>
    patch({ keys: { ...draft.keys, [preset.id]: value } })

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
    setSaved(cleaned)
    setDraft(cleaned)
    setEditing(false)
  }

  return (
    <div className="fixed inset-0 z-[100] flex items-center justify-center bg-black/40 p-4">
      <div className="max-w-sm w-[90%] max-h-[85vh] overflow-y-auto bg-white rounded-2xl shadow-xl border border-paper-border p-4 space-y-3">
        <div className="flex items-center justify-between">
          <h2 className="text-base font-semibold text-ink flex items-center gap-2">
            <Sparkles className="w-4 h-4 text-amber-600" />
            {needSetup ? 'AI 设置' : '一键填充'}
          </h2>
          {!running && (
            <button
              type="button"
              onClick={onClose}
              className="p-1 rounded text-ink-muted hover:bg-stone-100"
              aria-label="关闭"
            >
              <X className="w-4 h-4" />
            </button>
          )}
        </div>

        {needSetup ? (
          <>
            <p className="text-xs text-ink-muted leading-relaxed">
              填充由 AI 完成，需要你自己的 API Key。
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

            <input
              type="password"
              value={draftKey}
              onChange={(e) => setKey(e.target.value)}
              placeholder={preset.editable ? '粘贴 API Key' : `粘贴 ${preset.name} 的 API Key`}
              className={inputClass}
            />

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
              {ready && (
                <button
                  type="button"
                  className="h-9 px-3 rounded-lg border border-stone-300 text-stone-600 text-sm hover:bg-stone-50"
                  onClick={() => {
                    setDraft(saved)
                    setEditing(false)
                    setTest({ phase: 'idle' })
                  }}
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
        ) : (
          <>
            <p className="text-xs text-ink-muted leading-relaxed">
              将为「{scopeName}」里
              <span className="text-ink font-medium">还有格子空着</span>
              的笔记补上：单词补音标、词性、中文释义；短语补释义与用法；句子补句型说明与翻译。
              <span className="text-ink font-medium">只补空着的那几格，你写过的一个字都不动。</span>
            </p>

            <div className="rounded-lg bg-stone-50 border border-paper-border p-2.5 text-sm text-ink">
              待填充：
              {pendingWords > 0 && <span className="ml-1">{pendingWords} 个单词</span>}
              {pendingWords > 0 && pendingPhrases > 0 && <span className="mx-1">·</span>}
              {pendingPhrases > 0 && <span>{pendingPhrases} 个短语</span>}
              {(pendingWords > 0 || pendingPhrases > 0) && pendingSentences > 0 && (
                <span className="mx-1">·</span>
              )}
              {pendingSentences > 0 && <span>{pendingSentences} 个句子</span>}
              {total === 0 && <span className="ml-1 text-ink-muted">都填全了</span>}
            </div>

            {running && (
              <div className="space-y-1.5">
                <div className="h-1.5 rounded-full bg-stone-200 overflow-hidden">
                  <div
                    className="h-full bg-amber-500 transition-all duration-300"
                    style={{ width: `${percent}%` }}
                  />
                </div>
                <p className="text-xs text-ink-muted">
                  已处理 {state.progress.done} / {state.progress.total}，
                  成功填上 {state.progress.filled} 条
                </p>
              </div>
            )}

            {state.phase === 'done' && (
              <p className="text-sm text-ink">
                完成，共填上 {state.progress.filled} 条。
                {state.message && <span className="text-ink-muted"> {state.message}</span>}
              </p>
            )}

            {state.phase === 'error' && (
              <p className="text-sm text-red-600 leading-relaxed break-words">{state.message}</p>
            )}

            <p className="text-xs text-ink-muted leading-relaxed">
              内容由 AI 生成，会标上「AI」记号，可能有错，建议复核。
              单词和它所在的那一行会被发送给 <span className="break-all">{savedTarget}</span>。
            </p>

            <div className="flex gap-2 pt-1">
              {running ? (
                <button
                  type="button"
                  className="flex-1 h-9 rounded-lg border border-stone-300 text-stone-600 text-sm hover:bg-stone-50"
                  onClick={onCancel}
                >
                  停止（已填的会保留）
                </button>
              ) : (
                <>
                  <button
                    type="button"
                    className="h-9 px-3 rounded-lg border border-stone-300 text-stone-600 text-sm hover:bg-stone-50"
                    onClick={() => setEditing(true)}
                  >
                    AI 设置
                  </button>
                  <button
                    type="button"
                    disabled={total === 0}
                    className="flex-1 h-9 rounded-lg bg-amber-600 hover:bg-amber-700 disabled:opacity-40 text-white text-sm font-medium"
                    onClick={onStart}
                  >
                    {state.phase === 'done' || state.phase === 'error' ? '再试一次' : '开始填充'}
                  </button>
                </>
              )}
            </div>
          </>
        )}
      </div>
    </div>
  )
}
