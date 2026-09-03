import { useEffect, useState } from 'react'
import { Wand2, X } from 'lucide-react'
import { AiSettingsPanel } from './AiSettingsPanel'
import {
  AMOUNT_HINT,
  AMOUNT_LABEL,
  LEVEL_LABEL,
  loadMarkOptions,
  saveMarkOptions
} from '../mark/options'
import type { MarkAmount, MarkLevel, MarkOptions, MarkProgress } from '../mark'
import { describeTarget, loadConfig, resolveConfig, type AiConfig } from '../enrich'
import { useBackHandler, BackPriority } from '../hooks/useBackHandler'

/**
 * 「一键划词」对话框。
 *
 * 和「一键填充」是两件事：填充是给**已有的笔记**补空格子，
 * 划词是从正文里**挑出新的**词和短语。所以入口也分开 ——
 * 填充在复习页（那里才看得到笔记），划词在阅读页的生词板顶上（那里才看得到正文）。
 */

export type MarkPhase = 'idle' | 'running' | 'done' | 'error'

export interface AutoMarkState {
  phase: MarkPhase
  progress: MarkProgress
  message?: string
}

interface AutoMarkDialogProps {
  open: boolean
  /** 当前文档名，写进「将通读《xxx》」那句话 */
  docName: string
  state: AutoMarkState
  onStart: (options: MarkOptions) => void
  onCancel: () => void
  onClose: () => void
}

const LEVELS: MarkLevel[] = ['cet4', 'cet6', 'kaoyan', 'ielts']
const AMOUNTS: MarkAmount[] = ['few', 'medium', 'many']

export function AutoMarkDialog({
  open,
  docName,
  state,
  onStart,
  onCancel,
  onClose
}: AutoMarkDialogProps) {
  // 初值当场读出来，不留「先渲染一帧默认档再跳成上次那档」的闪烁
  const [options, setOptions] = useState<MarkOptions>(loadMarkOptions)
  /**
   * AI 配置。和「一键填充」是同一份 —— 设一次两边都能用。
   * 从前这里没有设置面板，点「AI 设置」会把用户甩到填充弹窗去，
   * 弹窗内容整个变成填充的，逻辑明显不对。现在两边共用同一个面板组件。
   */
  const [aiConfig, setAiConfig] = useState<AiConfig>(loadConfig)
  const [editingAi, setEditingAi] = useState(false)
  const ready = resolveConfig(aiConfig) !== null
  const needSetup = !ready || editingAi
  const running = state.phase === 'running'

  useEffect(() => {
    if (open) {
      setOptions(loadMarkOptions())
      setAiConfig(loadConfig())
      setEditingAi(false)
    }
  }, [open])

  // 返回键：跑的时候先取消，闲着的时候直接关
  useBackHandler(open, BackPriority.orphanPrompt, () => (running ? onCancel() : onClose()))

  if (!open) return null

  const percent =
    state.progress.total > 0 ? Math.round((state.progress.done / state.progress.total) * 100) : 0

  const pick = (change: Partial<MarkOptions>) => {
    const next = { ...options, ...change }
    setOptions(next)
    saveMarkOptions(next)
  }

  const start = () => onStart(options)

  /**
   * 点弹窗外面的空白处：关掉。和设置弹窗一个做法（遮罩接点击、卡片挡住冒泡）。
   *
   * 两处例外，都是照着这个弹窗已有的规矩来的：
   * - **跑着的时候不响应**。右上角那颗关闭键此时本来就是藏起来的
   *   （`{!running && ...}`），点外面要是能关，等于给它开了个后门，
   *   手一滑就把正在跑的任务打断了。安卓返回键另有规矩（跑着时按返回 = 取消任务），
   *   那是明确的一次按键，不算误触，所以不动它。
   * - **在「AI 设置」那一屏时退回上一屏**，而不是整个关掉 —— 和设置弹窗一致。
   */
  const closeOnBackdrop = () => {
    if (running) return
    if (editingAi) return setEditingAi(false)
    onClose()
  }

  return (
    <div
      className="fixed inset-0 z-[100] flex items-center justify-center bg-black/40 p-4 kb-safe"
      onClick={closeOnBackdrop}
    >
      <div
        className="max-w-sm w-[90%] max-h-[85vh] overflow-y-auto bg-white rounded-2xl shadow-xl border border-paper-border p-4 space-y-3"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between">
          <h2 className="text-base font-semibold text-ink flex items-center gap-2">
            <Wand2 className="w-4 h-4 text-accent-600" />
            {needSetup ? 'AI 设置' : '一键划词'}
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
          <AiSettingsPanel
            onSaved={(cfg) => {
              setAiConfig(cfg)
              setEditingAi(false)
            }}
            onCancel={ready ? () => setEditingAi(false) : undefined}
          />
        ) : (
          <>
            <p className="text-xs text-ink-muted leading-relaxed">
              AI 会通读《{docName}》，挑出值得记的单词和短语，
              <span className="text-ink font-medium">直接划在正文上并填好释义</span>。
              划完可以整批撤销。
            </p>

            <div className="space-y-1.5">
              <p className="text-xs font-medium text-ink-muted">难度：只划到得上这个水平的词</p>
              <div className="flex gap-1.5">
                {LEVELS.map((l) => (
                  <button
                    key={l}
                    type="button"
                    disabled={running}
                    onClick={() => pick({ level: l })}
                    className={
                      'flex-1 h-8 rounded-lg text-sm border disabled:opacity-40 ' +
                      (l === options.level
                        ? 'border-accent-500 bg-accent-50 text-accent-800 font-medium'
                        : 'border-paper-border text-ink-muted hover:bg-stone-50')
                    }
                  >
                    {LEVEL_LABEL[l]}
                  </button>
                ))}
              </div>
            </div>

            <div className="space-y-1.5">
              <p className="text-xs font-medium text-ink-muted">一次划多少</p>
              <div className="flex gap-1.5">
                {AMOUNTS.map((a) => (
                  <button
                    key={a}
                    type="button"
                    disabled={running}
                    onClick={() => pick({ amount: a })}
                    className={
                      'flex-1 h-8 rounded-lg text-sm border disabled:opacity-40 ' +
                      (a === options.amount
                        ? 'border-accent-500 bg-accent-50 text-accent-800 font-medium'
                        : 'border-paper-border text-ink-muted hover:bg-stone-50')
                    }
                  >
                    {AMOUNT_LABEL[a]}
                  </button>
                ))}
              </div>
              <p className="text-xs text-ink-muted">{AMOUNT_HINT[options.amount]}</p>
            </div>

            {running && (
              <div className="space-y-1.5">
                <div className="h-1.5 rounded-full bg-stone-200 overflow-hidden">
                  <div
                    className="h-full bg-accent-500 transition-all duration-300"
                    style={{ width: `${percent}%` }}
                  />
                </div>
                <p className="text-xs text-ink-muted">
                  已读 {state.progress.done} / {state.progress.total} 行，
                  已划上 {state.progress.marked} 条
                </p>
              </div>
            )}

            {state.phase === 'done' && (
              <p className="text-sm text-ink leading-relaxed">
                划上了 {state.progress.marked} 条。
                {state.progress.missed > 0 && (
                  <span className="text-ink-muted">
                    {' '}
                    另有 {state.progress.missed} 条 AI 挑了但没对上原文，已跳过。
                  </span>
                )}
                {state.progress.marked === 0 && state.progress.missed === 0 && (
                  <span className="text-ink-muted"> 这一篇里没找到够这个难度的词，换低一档试试。</span>
                )}
              </p>
            )}

            {state.phase === 'error' && (
              <p className="text-sm text-red-600 leading-relaxed break-words">{state.message}</p>
            )}

            <p className="text-xs text-ink-muted leading-relaxed">
              划出来的内容由 AI 生成，会标上「AI」记号，可能有错，建议复核。
              这篇文档的英文正文会被发送给 <span className="break-all">{describeTarget(aiConfig)}</span>。
            </p>

            <div className="flex gap-2 pt-1">
              {running ? (
                <button
                  type="button"
                  className="flex-1 h-9 rounded-lg border border-stone-300 text-stone-600 text-sm hover:bg-stone-50"
                  onClick={onCancel}
                >
                  停止（已划的会保留）
                </button>
              ) : (
                <>
                  <button
                    type="button"
                    className="h-9 px-3 rounded-lg border border-stone-300 text-stone-600 text-sm hover:bg-stone-50"
                    onClick={() => setEditingAi(true)}
                  >
                    AI 设置
                  </button>
                  <button
                    type="button"
                    className="flex-1 h-9 rounded-lg bg-accent-600 hover:bg-accent-700 text-white text-sm font-medium"
                    onClick={state.phase === 'done' ? onClose : start}
                  >
                    {state.phase === 'done' ? '看看' : state.phase === 'error' ? '再试一次' : '开始划词'}
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
