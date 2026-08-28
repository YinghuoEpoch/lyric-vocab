import { useEffect, useRef, useState } from 'react'
import { Sparkles, X } from 'lucide-react'
import { getApiKey, setApiKey } from '../enrich'
import type { FillProgress } from '../enrich'
import { useBackHandler, BackPriority } from '../hooks/useBackHandler'

/**
 * 「一键填充」对话框。
 *
 * 第一次用会先要 API Key —— 不做成设置页里的一项，是因为它只在这里用得上，
 * 放在用得到的地方最好找。
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
  /** 待填充的数量 */
  emptyWords: number
  emptySentences: number
  /** 当前范围的名字，例如某个文库或某篇文档 */
  scopeName: string
  state: AutoFillState
  onStart: () => void
  onCancel: () => void
  onClose: () => void
}

export function AutoFillDialog({
  open,
  emptyWords,
  emptySentences,
  scopeName,
  state,
  onStart,
  onCancel,
  onClose
}: AutoFillDialogProps) {
  const [keyInput, setKeyInput] = useState('')
  const [editingKey, setEditingKey] = useState(false)
  /**
   * 已保存的 Key 必须放进 state。
   * 直接在渲染时读 localStorage 的话，保存之后没有任何 state 变化，
   * 组件不会重渲染，界面就一直停在「请填 Key」那一屏。
   */
  const [savedKey, setSavedKey] = useState('')
  const inputRef = useRef<HTMLInputElement>(null)

  const needKey = !savedKey || editingKey
  const running = state.phase === 'running'

  useEffect(() => {
    if (open) {
      const current = getApiKey()
      setSavedKey(current)
      setKeyInput(current)
      setEditingKey(false)
    }
  }, [open])

  useEffect(() => {
    if (open && needKey) inputRef.current?.focus()
  }, [open, needKey])

  // 返回键：跑的时候先取消，闲着的时候直接关
  useBackHandler(open, BackPriority.orphanPrompt, () => (running ? onCancel() : onClose()))

  if (!open) return null

  const total = emptyWords + emptySentences
  const percent =
    state.progress.total > 0 ? Math.round((state.progress.done / state.progress.total) * 100) : 0

  const handleSaveKey = () => {
    setApiKey(keyInput)
    setSavedKey(keyInput.trim())
    setEditingKey(false)
  }

  return (
    <div className="fixed inset-0 z-[100] flex items-center justify-center bg-black/40 p-4">
      <div className="max-w-sm w-[90%] max-h-[85vh] overflow-y-auto bg-white rounded-2xl shadow-xl border border-paper-border p-4 space-y-3">
        <div className="flex items-center justify-between">
          <h2 className="text-base font-semibold text-ink flex items-center gap-2">
            <Sparkles className="w-4 h-4 text-amber-600" />
            一键填充
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

        {needKey ? (
          <>
            <p className="text-xs text-ink-muted leading-relaxed">
              填充由 DeepSeek 完成，需要你自己的 API Key。
              Key 只保存在这台手机上，不会上传，也不会写进导出的备份文件。
            </p>
            <input
              ref={inputRef}
              type="password"
              value={keyInput}
              onChange={(e) => setKeyInput(e.target.value)}
              placeholder="粘贴 API Key"
              className="w-full h-9 px-2 text-sm rounded-lg border border-paper-border bg-stone-50/80 text-ink placeholder-ink-muted focus:outline-none focus:ring-1 focus:ring-amber-500/40 focus:border-amber-500"
            />
            <div className="flex gap-2 pt-1">
              {savedKey && (
                <button
                  type="button"
                  className="flex-1 h-9 rounded-lg border border-stone-300 text-stone-600 text-sm hover:bg-stone-50"
                  onClick={() => setEditingKey(false)}
                >
                  取消
                </button>
              )}
              <button
                type="button"
                disabled={!keyInput.trim()}
                className="flex-1 h-9 rounded-lg bg-amber-600 hover:bg-amber-700 disabled:opacity-40 text-white text-sm font-medium"
                onClick={handleSaveKey}
              >
                保存
              </button>
            </div>
          </>
        ) : (
          <>
            <p className="text-xs text-ink-muted leading-relaxed">
              将为「{scopeName}」里
              <span className="text-ink font-medium">还没有填写任何内容</span>
              的笔记补上：单词填音标、词性、中文释义；句子填句型说明与翻译。
              <span className="text-ink font-medium">已经写过的内容不会被改动。</span>
            </p>

            <div className="rounded-lg bg-stone-50 border border-paper-border p-2.5 text-sm text-ink">
              待填充：
              {emptyWords > 0 && <span className="ml-1">{emptyWords} 个单词</span>}
              {emptyWords > 0 && emptySentences > 0 && <span className="mx-1">·</span>}
              {emptySentences > 0 && <span>{emptySentences} 个句子</span>}
              {total === 0 && <span className="ml-1 text-ink-muted">没有空白笔记</span>}
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
              <p className="text-sm text-red-600 leading-relaxed">{state.message}</p>
            )}

            <p className="text-xs text-ink-muted leading-relaxed">
              内容由 AI 生成，会标上「AI」记号，可能有错，建议复核。
              单词和它所在的那一行会被发送给 DeepSeek。
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
                    onClick={() => setEditingKey(true)}
                  >
                    换 Key
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
