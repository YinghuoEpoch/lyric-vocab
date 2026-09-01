import { useEffect, useRef, useState } from 'react'
import { ChevronRight, Settings as SettingsIcon, X } from 'lucide-react'
import { AiSettingsPanel } from './AiSettingsPanel'
import { cacheStats, clearCache, formatBytes, type CacheStats } from '../speech/audioCache'
import { UserGuide } from './UserGuide'
import { AGREEMENT_CLAUSES, AGREEMENT_TITLE } from '../agreement'
import { describeTarget, loadConfig, resolveConfig, type AiConfig } from '../enrich'
import { useBackHandler, BackPriority } from '../hooks/useBackHandler'
import type { ReaderSettings } from '../types'

/**
 * 设置页。
 *
 * 从前这些东西散在三处：阅读外观是左侧栏底下的一个浮层，备份和恢复是底栏
 * 另外两个没有文字的图标，AI 设置压根没有自己的入口 —— 它只作为「一键填充」
 * 「一键划词」两个弹窗里的一个分支存在，想换个 Key 得先假装要跑一次填充。
 * 现在四类都收在这一屏里。
 *
 * 两个弹窗里的「AI 设置」按钮**保留着**：头一回用填充或划词的人就地能配才顺，
 * 赶去设置页再走回来更烦。三处共用同一个 AiSettingsPanel，不是写了三遍。
 *
 * 「一键划词」的难度和数量**没有**搬进来：那是每次跑之前的选择
 * （这篇挑多点、那篇挑少点），不是一劳永逸的偏好，搬走反而更难用。
 */

interface SettingsDialogProps {
  open: boolean
  onClose: () => void
  readerSettings: ReaderSettings
  onReaderSettingsChange: (s: ReaderSettings) => void
  onExportBackup: () => void
  onRestoreBackup: (file: File) => void
}

const FONT_FAMILIES = [
  { id: 'sans', label: '无衬线' },
  { id: 'serif', label: '衬线' },
  { id: 'rounded', label: '圆体' }
] as const

const THEMES = [
  { id: 'pure', label: '标准' },
  { id: 'original', label: '青灰' },
  { id: 'rice', label: '暖白' }
] as const

/** 一组设置：标题小而灰，底下一张浅色卡片装内容 */
function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="space-y-1.5">
      <h3 className="text-xs font-medium text-ink-muted px-0.5">{title}</h3>
      <div className="rounded-xl border border-paper-border bg-stone-50/60 p-3 space-y-3">
        {children}
      </div>
    </section>
  )
}

/** 一排等宽的单选按钮。字体和主题长得一样，所以收成一个 */
function Choices<T extends string>({
  value,
  options,
  onPick
}: {
  value: T
  options: ReadonlyArray<{ id: T; label: string }>
  onPick: (id: T) => void
}) {
  return (
    <div className="flex gap-1.5">
      {options.map((o) => (
        <button
          key={o.id}
          type="button"
          onClick={() => onPick(o.id)}
          className={
            'flex-1 h-8 rounded-lg text-xs font-medium border transition-colors ' +
            (value === o.id
              ? 'border-amber-500 bg-amber-50 text-amber-800'
              : 'border-paper-border bg-white text-ink-muted hover:bg-stone-100')
          }
        >
          {o.label}
        </button>
      ))}
    </div>
  )
}

export function SettingsDialog({
  open,
  onClose,
  readerSettings,
  onReaderSettingsChange,
  onExportBackup,
  onRestoreBackup
}: SettingsDialogProps) {
  /**
   * AI 配置当场读出来。理由和两个弹窗里一样：先渲染一帧空配置的话，
   * 密码框会一闪而过，手机上足够把安全键盘叫出来，而框随即消失就关不掉了。
   */
  const [aiConfig, setAiConfig] = useState<AiConfig>(loadConfig)
  /** 正在配 AI：整屏换成设置面板，标题跟着换 */
  const [editingAi, setEditingAi] = useState(false)
  /** 正在看用户协议 */
  const [showAgreement, setShowAgreement] = useState(false)
  /** 正在看使用说明 */
  const [showGuide, setShowGuide] = useState(false)
  const backupInputRef = useRef<HTMLInputElement>(null)
  /** 存了多少发音。打开设置页时读一次就够，不用一直盯着 */
  const [audioStats, setAudioStats] = useState<CacheStats | null>(null)

  useEffect(() => {
    if (open) {
      setAiConfig(loadConfig())
      setEditingAi(false)
      setShowAgreement(false)
      setShowGuide(false)
      setAudioStats(null)
      void cacheStats().then(setAudioStats)
    }
  }, [open])

  /**
   * 返回键只登记一层，自己判断退到哪：在子屏里退回列表，在列表里才关掉。
   * 分成两层登记的话，AI 那屏一开一关要多一轮注册注销，没必要。
   */
  useBackHandler(open, BackPriority.settings, () => {
    if (editingAi) setEditingAi(false)
    else if (showAgreement) setShowAgreement(false)
    else if (showGuide) setShowGuide(false)
    else onClose()
  })

  if (!open) return null

  /**
   * 两行分别说「发给谁」和「用哪个模型」。
   * 上面这行不能用供应商名字：内置的 DeepSeek 那行和 describeTarget 一模一样，
   * 两行会重复成「DeepSeek / DeepSeek」（在浏览器里一眼看出来的）；
   * 而自定义供应商叫「自定义」等于没说，得显示实际域名。
   */
  const resolvedAi = resolveConfig(aiConfig)
  const inSubScreen = editingAi || showAgreement || showGuide
  const title = editingAi
    ? 'AI 设置'
    : showAgreement
      ? AGREEMENT_TITLE
      : showGuide
        ? '使用说明'
        : '设置'
  const back = editingAi
    ? () => setEditingAi(false)
    : showAgreement
      ? () => setShowAgreement(false)
      : showGuide
        ? () => setShowGuide(false)
        : onClose

  const setFontSize = (size: number) =>
    onReaderSettingsChange({ ...readerSettings, fontSize: size })

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/40"
      onClick={back}
    >
      <div
        className="w-full max-w-md max-h-[85vh] flex flex-col bg-white rounded-2xl shadow-xl border border-paper-border"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="shrink-0 flex items-center justify-between gap-2 p-3 border-b border-paper-border">
          <span className="text-base font-semibold text-ink flex items-center gap-2 min-w-0">
            <SettingsIcon className="w-4 h-4 text-amber-600 shrink-0" />
            <span className="truncate">{title}</span>
          </span>
          <button
            type="button"
            onClick={back}
            className="shrink-0 p-1.5 rounded-lg text-ink-muted hover:bg-stone-100"
            aria-label={inSubScreen ? '返回' : '关闭'}
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        <div className="flex-1 min-h-0 overflow-y-auto scroll-area p-3 space-y-4">
          {editingAi ? (
            <div className="space-y-3">
              <AiSettingsPanel
                onSaved={(cfg) => {
                  setAiConfig(cfg)
                  setEditingAi(false)
                }}
                onCancel={() => setEditingAi(false)}
              />
            </div>
          ) : showGuide ? (
            <UserGuide />
          ) : showAgreement ? (
            <div className="space-y-2 text-xs leading-relaxed text-ink-muted">
              {AGREEMENT_CLAUSES.map((line) => (
                <p key={line}>{line}</p>
              ))}
            </div>
          ) : (
            <>
              <Section title="上手">
                <button
                  type="button"
                  onClick={() => setShowGuide(true)}
                  className="w-full flex items-center gap-2 text-left"
                >
                  <span className="flex-1 min-w-0">
                    <span className="text-sm text-ink block">使用说明</span>
                    <span className="text-xs text-ink-muted block">
                      界面上不太容易看出来的那些用法
                    </span>
                  </span>
                  <ChevronRight className="w-4 h-4 text-ink-muted shrink-0" />
                </button>
              </Section>

              <Section title="阅读外观">
                <div className="flex items-center justify-between gap-2">
                  <span className="text-sm text-ink">字号</span>
                  <div className="flex items-center gap-1">
                    <button
                      type="button"
                      onClick={() => setFontSize(Math.max(12, readerSettings.fontSize - 2))}
                      className="w-8 h-8 rounded-lg border border-paper-border bg-white hover:bg-stone-100 text-ink text-sm font-medium"
                      aria-label="调小字号"
                    >
                      −
                    </button>
                    <span className="w-8 text-center text-sm text-ink tabular-nums">
                      {readerSettings.fontSize}
                    </span>
                    <button
                      type="button"
                      onClick={() => setFontSize(Math.min(24, readerSettings.fontSize + 2))}
                      className="w-8 h-8 rounded-lg border border-paper-border bg-white hover:bg-stone-100 text-ink text-sm font-medium"
                      aria-label="调大字号"
                    >
                      +
                    </button>
                  </div>
                </div>
                <div className="space-y-1.5">
                  <span className="text-sm text-ink block">字体</span>
                  <Choices
                    value={readerSettings.fontFamily}
                    options={FONT_FAMILIES}
                    onPick={(f) => onReaderSettingsChange({ ...readerSettings, fontFamily: f })}
                  />
                </div>
                <div className="space-y-1.5">
                  <span className="text-sm text-ink block">主题</span>
                  <Choices
                    value={readerSettings.theme}
                    options={THEMES}
                    onPick={(t) => onReaderSettingsChange({ ...readerSettings, theme: t })}
                  />
                </div>
              </Section>

              <Section title="AI">
                <button
                  type="button"
                  onClick={() => setEditingAi(true)}
                  className="w-full flex items-center gap-2 text-left"
                >
                  <span className="flex-1 min-w-0">
                    <span className="text-sm text-ink block truncate">
                      {resolvedAi ? describeTarget(aiConfig) : '还没设置'}
                    </span>
                    <span className="text-xs text-ink-muted block truncate">
                      {resolvedAi ? resolvedAi.model : '填上 API Key 才能用填充和划词'}
                    </span>
                  </span>
                  <ChevronRight className="w-4 h-4 text-ink-muted shrink-0" />
                </button>
                <p className="text-xs text-ink-muted leading-relaxed">
                  「一键填充」和「一键划词」共用这一份配置。Key 只存在这台手机上，
                  不会上传，也不会写进导出的备份文件。
                </p>
              </Section>

              <Section title="发音">
                <div className="flex items-center justify-between gap-2">
                  <span className="flex-1 min-w-0 text-sm text-ink">
                    {audioStats === null
                      ? '正在统计…'
                      : audioStats.count === 0
                        ? '还没存下任何发音'
                        : `已存 ${audioStats.count} 个发音，占 ${formatBytes(audioStats.bytes)}`}
                  </span>
                  <button
                    type="button"
                    disabled={!audioStats || audioStats.count === 0}
                    onClick={async () => {
                      await clearCache()
                      setAudioStats(await cacheStats())
                    }}
                    className="shrink-0 h-9 px-3 rounded-lg border border-paper-border bg-white text-sm text-ink hover:bg-stone-100 disabled:opacity-40"
                  >
                    清空
                  </button>
                </div>
                <p className="text-xs text-ink-muted leading-relaxed">
                  单词和短语读过一次就存在这台手机上，之后不用联网、也没有等开口的停顿。
                  清空只是删掉存的录音，笔记一条都不会动，下次点还会重新取。
                </p>
              </Section>

              <Section title="数据">
                <input
                  ref={backupInputRef}
                  type="file"
                  accept=".json,application/json"
                  className="hidden"
                  onChange={(e) => {
                    const file = e.target.files?.[0]
                    if (file) onRestoreBackup(file)
                    e.target.value = ''
                  }}
                />
                <div className="flex gap-2">
                  <button
                    type="button"
                    onClick={onExportBackup}
                    className="flex-1 h-9 rounded-lg border border-paper-border bg-white text-sm text-ink hover:bg-stone-100"
                  >
                    导出备份
                  </button>
                  <button
                    type="button"
                    onClick={() => backupInputRef.current?.click()}
                    className="flex-1 h-9 rounded-lg border border-paper-border bg-white text-sm text-ink hover:bg-stone-100"
                  >
                    恢复备份
                  </button>
                </div>
                <p className="text-xs text-ink-muted leading-relaxed">
                  备份是一个 .json 文件，文库、正文和笔记都在里面。
                  恢复会用文件里的内容覆盖现在的数据。
                </p>
              </Section>

              <Section title="关于">
                <button
                  type="button"
                  onClick={() => setShowAgreement(true)}
                  className="w-full flex items-center gap-2 text-left"
                >
                  <span className="flex-1 text-sm text-ink">{AGREEMENT_TITLE}</span>
                  <ChevronRight className="w-4 h-4 text-ink-muted shrink-0" />
                </button>
                <p className="text-xs text-ink-muted">© 2026 荧惑纪 . All Rights Reserved.</p>
              </Section>
            </>
          )}
        </div>
      </div>
    </div>
  )
}
