import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import { ChevronRight, Settings as SettingsIcon, X } from 'lucide-react'
import { AiSettingsPanel } from './AiSettingsPanel'
import { cacheStats, clearCache, formatBytes, type CacheStats } from '../speech/audioCache'
import { UserGuide } from './UserGuide'
import { AGREEMENT_CLAUSES, AGREEMENT_TITLE } from '../agreement'
import { describeTarget, loadConfig, resolveConfig, type AiConfig } from '../enrich'
import { useBackHandler, BackPriority } from '../hooks/useBackHandler'
import { getSafeAreaReport, type SafeAreaReport } from '../safeArea'
import { CloudTtsPanel } from './CloudTtsPanel'
import { SyncPanel } from './SyncPanel'
import { loadSyncConfig, saveSyncConfig, isSyncReady, type SyncConfig } from '../sync'
import {
  loadCloudConfig,
  saveCloudConfig,
  isCloudReady,
  type CloudTtsConfig
} from '../speech/cloudTts'
import {
  diagnoseSpeech,
  tryRead,
  tryCloudRead,
  CLOUD_SAMPLE,
  TRY_SAMPLES,
  type Answer,
  type SpeechDiagnosis,
  type TryReadResult
} from '../speech/diagnose'
import type { AccentColor, ReaderSettings } from '../types'
import type { SyncStatus } from '../hooks/useSync'

/** 一问一答：问出来了就显示答案，报错了就把原文摊出来 —— 诊断要的正是原文 */
function AnswerRow({ label, answer }: { label: string; answer: Answer }) {
  return (
    <Row
      label={label}
      value={
        answer.ok ? (
          answer.value
        ) : (
          <span className="text-rose-600">报错：{answer.error}</span>
        )
      }
    />
  )
}

/**
 * 朗读引擎参数。
 *
 * 起因见 后续规划.md 第五十七节：平板上凡是过系统朗读引擎的一概没声音，
 * 而无障碍的「屏幕朗读」念得了英文 —— 引擎和英文数据都在，是我们这条路没走通。
 * 我在电脑上验不了安卓的朗读引擎，所以照第四十九节那条老办法先摆读数。
 *
 * 三颗试读按钮是这一屏的重点，**中文那颗是分水岭**：
 * 中文能读、英文不能，就是缺英文数据；两个都不能，问题在引擎或者我们的调用。
 */
function SpeechReadout({
  diag,
  results,
  onTry,
  running,
  cloudReady,
  onCloudTry
}: {
  diag: SpeechDiagnosis | null
  results: Record<string, TryReadResult>
  onTry: (key: string, text: string, lang: string) => void
  running: string | null
  cloudReady: boolean
  onCloudTry: () => void
}) {
  return (
    <div className="space-y-4">
      <Section title="引擎认不认英文">
        <Row label="装成 app 了吗" value={diag ? (diag.native ? '是' : '不是（浏览器里）') : '—'} />
        <Row
          label="朗读插件挂上了吗"
          value={diag ? (diag.pluginAvailable ? '挂上了' : '没挂上') : '—'}
        />
        {diag ? <AnswerRow label="认 en-US 吗" answer={diag.english} /> : null}
        {diag ? <AnswerRow label="英文语言" answer={diag.englishLangs} /> : null}
        {diag ? <AnswerRow label="语言共几个" answer={diag.langCount} /> : null}
        {diag ? <AnswerRow label="嗓子共几个" answer={diag.voiceCount} /> : null}
        {diag ? <AnswerRow label="英文嗓子" answer={diag.englishVoices} /> : null}
        <p className="text-xs text-ink-muted leading-relaxed pt-1">
          语言和嗓子都是「一个都没有」，说明引擎其实没起来 —— 那和「有引擎但缺英文」是两码事。
        </p>
      </Section>

      <Section title="云端朗读">
        <Row label="配全了吗" value={cloudReady ? '配全了' : '还没填全'} />
        <button
          type="button"
          onClick={onCloudTry}
          disabled={running !== null}
          className="w-full px-3 py-2 rounded-lg border border-paper-border bg-white text-sm text-ink text-left disabled:opacity-50"
        >
          {running === 'cloud' ? '正在问云端…' : '云端试读'}
          <span className="block text-xs text-ink-muted truncate">{CLOUD_SAMPLE}</span>
        </button>
        {results.cloud ? (
          <p className="px-1 text-xs leading-relaxed break-all">
            {results.cloud.ok ? (
              <span className="text-emerald-700">
                成功，用了 {results.cloud.ms} 毫秒。{results.cloud.error}
              </span>
            ) : (
              <span className="text-rose-600">
                失败（{results.cloud.ms} 毫秒）：{results.cloud.error}
              </span>
            )}
          </p>
        ) : null}
        <p className="text-xs text-ink-muted leading-relaxed pt-1">
          这里显示的是服务商的原话，没经过翻译 —— Key 填错、额度用完、服务没开通、
          音色名不对，四种说法各不相同，而处理办法也各不相同。成功就会当场放出声来。
        </p>
      </Section>

      <Section title="试读（不查真人录音，直接考引擎）">
        <div className="space-y-2">
          {TRY_SAMPLES.map((sample) => {
            const r = results[sample.key]
            return (
              <div key={sample.key} className="space-y-1">
                <button
                  type="button"
                  onClick={() => onTry(sample.key, sample.text, sample.lang)}
                  disabled={running !== null}
                  className="w-full px-3 py-2 rounded-lg border border-paper-border bg-white text-sm text-ink text-left disabled:opacity-50"
                >
                  {running === sample.key ? '正在读…' : sample.label}
                  <span className="block text-xs text-ink-muted truncate">{sample.text}</span>
                </button>
                {r ? (
                  <p className="px-1 text-xs leading-relaxed break-all">
                    {r.ok ? (
                      <span className="text-emerald-700">
                        引擎说成功，用了 {r.ms} 毫秒
                        {r.ms < 300 ? '（太快了 —— 它大概压根没开口）' : ''}
                      </span>
                    ) : (
                      <span className="text-rose-600">
                        失败（{r.ms} 毫秒）：{r.error}
                      </span>
                    )}
                  </p>
                ) : null}
              </div>
            )
          })}
        </div>
        <p className="text-xs text-ink-muted leading-relaxed pt-1">
          耗时是关键：插件是「念完才返回」的。说成功却几乎立刻返回，就是报成功不出声；
          耗时和一句话差不多却听不见，那声音是丢在音量或者声音通道上了。
        </p>
      </Section>
    </div>
  )
}

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
  /** 同步的状态和那颗手动按钮。时机住在 App 里（回前台、改完延迟传），这里只显示和触发 */
  syncStatus: SyncStatus
  onSyncNow: () => void
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

/**
 * 强调色。`swatch` 是给按钮自己显示用的死色 ——
 * 不能用 accent-600 那种类名，否则五颗点会一起变成当前选中的颜色，
 * 每颗必须显示它自己代表的色。色阶本体在 src/index.css。
 */
const ACCENTS = [
  { id: 'amber', label: '琥珀', swatch: '#b45309' },
  { id: 'indigo', label: '墨蓝', swatch: '#4338ca' },
  { id: 'teal', label: '松绿', swatch: '#0f766e' },
  { id: 'rose', label: '朱红', swatch: '#be123c' },
  { id: 'stone', label: '石墨', swatch: '#44403c' }
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

/** 「开发者 → 系统栏参数」那一屏。一行一个数，名字用大白话 */
function Row({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div className="flex items-baseline justify-between gap-3 py-1">
      <span className="shrink-0 text-xs text-ink-muted">{label}</span>
      <span className="min-w-0 text-right text-sm text-ink break-all">{value}</span>
    </div>
  )
}

/**
 * 系统栏参数。
 *
 * 本来是为了验一次沉浸式临时加的，用户验完说留着 —— 确实值得留：
 * 这几个数一摆出来，「留白对不对」「跑的是不是刚打的那一版网页」当场就有答案，
 * 不必再靠猜。改沉浸式那两轮的教训全在这一小屏里
 * （见 后续规划.md 第四十九节）。
 */
function SafeAreaReadout({
  info
}: {
  info: { report: SafeAreaReport; applied: string } | null
}) {
  const r = info?.report
  const navText =
    r?.navMode === 2
      ? '手势（不用让）'
      : r?.navMode === 0
        ? '三颗键'
        : r?.navMode === 1
          ? '两颗键'
          : `读不到（${r?.navMode ?? '—'}），按厚度判断`

  return (
    <div className="space-y-4">
      <Section title="系统栏让出的留白">
        <Row label="取值走的哪条路" value={r?.source ?? '—'} />
        <Row
          label="原生报的"
          value={`上 ${r?.top ?? '—'} / 右 ${r?.right ?? '—'} / 下 ${r?.bottom ?? '—'} / 左 ${r?.left ?? '—'}`}
        />
        <Row
          label="放按钮要让"
          value={`${r?.tappableBottom ?? '—'}（系统自报 ${r?.tappableRaw ?? '—'}）`}
        />
        <Row label="导航方式" value={navText} />
        <Row label="实际生效" value={info?.applied ?? '—'} />
        {r?.error ? <Row label="出错" value={r.error} /> : null}
        <p className="text-xs text-ink-muted leading-relaxed pt-1">
          底下那条有两种：三颗导航键是实心的，按钮压在下面就点不着，得整条让开；
          手势条是透的、点得穿，不用让。读不到导航方式时按厚度分 —— 细过 32 的当手势条。
        </p>
      </Section>

      <Section title="这台机器 / 这份网页">
        <Row
          label="屏幕"
          value={`${window.innerWidth}×${window.innerHeight} · 密度 ${r?.density ?? '—'}`}
        />
        <Row label="安卓版本" value={r?.sdk ?? '—'} />
        <Row label="网页打包于" value={r?.build ?? '—'} />
        <p className="text-xs text-ink-muted leading-relaxed pt-1">
          「网页打包于」对不上刚装的那一版，就说明跑的还是旧网页 —— 这个 app 从前栽过一次。
        </p>
      </Section>
    </div>
  )
}

/** 一排等宽的单选按钮。字体和纸色长得一样，所以收成一个 */
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
              ? 'border-accent-500 bg-accent-50 text-accent-800'
              : 'border-paper-border bg-white text-ink-muted hover:bg-stone-100')
          }
        >
          {o.label}
        </button>
      ))}
    </div>
  )
}

/**
 * 一排颜色点。选中的套一圈深色环 —— 环用中性色，
 * 否则选中琥珀时环也是琥珀，压在琥珀点上就看不见了。
 *
 * 名字写在上面那行标签里，不放 title：手机上没有悬停，title 等于没有
 * （这个坑项目里踩过三次，见 后续规划.md 第三十五节）。
 */
function AccentChoices({
  value,
  onPick
}: {
  value: AccentColor
  onPick: (id: AccentColor) => void
}) {
  return (
    <div className="flex gap-2.5">
      {ACCENTS.map((a) => (
        <button
          key={a.id}
          type="button"
          onClick={() => onPick(a.id)}
          aria-label={a.label}
          aria-pressed={value === a.id}
          className={
            'w-9 h-9 rounded-full p-[3px] border-2 transition-colors ' +
            (value === a.id ? 'border-ink' : 'border-transparent hover:border-stone-300')
          }
        >
          <span className="block w-full h-full rounded-full" style={{ background: a.swatch }} />
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
  onRestoreBackup,
  syncStatus,
  onSyncNow
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
  /** 那块能滚的区域。所有屏共用同一个，所以滚到哪儿要自己管 —— 见下面 enterSub */
  const scrollRef = useRef<HTMLDivElement>(null)
  /** 进子屏之前，主列表滚到哪儿了 */
  const savedScroll = useRef(0)
  /** 存了多少发音。打开设置页时读一次就够，不用一直盯着 */
  const [audioStats, setAudioStats] = useState<CacheStats | null>(null)
  /** 正在看开发者那一屏 */
  const [showDev, setShowDev] = useState(false)
  /** 系统栏留白这次取到了什么。进开发者那一屏时读一次 */
  const [insetInfo, setInsetInfo] = useState<{ report: SafeAreaReport; applied: string } | null>(
    null
  )
  /** 正在填云端朗读的凭证（AI 那一栏点进来的第二行） */
  const [editingCloud, setEditingCloud] = useState(false)
  /** 正在看「朗读引擎参数」那一屏 */
  const [showSpeechDev, setShowSpeechDev] = useState(false)
  /** 问引擎问出来的那几件事 */
  const [speechDiag, setSpeechDiag] = useState<SpeechDiagnosis | null>(null)
  /** 三颗试读按钮各自的结果 */
  const [tryResults, setTryResults] = useState<Record<string, TryReadResult>>({})
  /** 这会儿正在试读哪一句（按钮期间禁用，免得两句叠在一起，读数就废了） */
  const [tryRunning, setTryRunning] = useState<string | null>(null)
  /** 云端朗读的凭证。打开设置页时读一次，改一下存一下 */
  const [cloudConfig, setCloudConfig] = useState<CloudTtsConfig>(loadCloudConfig)
  /** 正在填坚果云的凭证 */
  const [editingSync, setEditingSync] = useState(false)
  const [syncConfig, setSyncConfig] = useState<SyncConfig>(loadSyncConfig)

  useEffect(() => {
    if (open) {
      setAiConfig(loadConfig())
      setEditingAi(false)
      setShowAgreement(false)
      setShowGuide(false)
      setShowDev(false)
      setEditingCloud(false)
      // 关掉再打开就从头开始 —— 用户明确说了不用一直记着
      savedScroll.current = 0
      setShowSpeechDev(false)
      setSpeechDiag(null)
      setTryResults({})
      setTryRunning(null)
      setCloudConfig(loadCloudConfig())
      setEditingSync(false)
      setSyncConfig(loadSyncConfig())
      setAudioStats(null)
      void cacheStats().then(setAudioStats)
    }
  }, [open])

  /**
   * 进开发者那一屏时现读一次 —— 转屏、收放键盘之后这些数会变，
   * 打开设置页那一刻读的可能已经过期了。
   *
   * 报上来的数和**真正生效**的 CSS 值两个都读：只看前者的话，
   * 万一变量写进去了、样式却没用上，还是查不出来。
   */
  const openDev = () => {
    const cs = getComputedStyle(document.documentElement)
    const applied = (['top', 'right', 'bottom', 'left', 'bottom-tap'] as const)
      .map((k) => cs.getPropertyValue(`--sa-${k}`).trim() || '?')
      .join(' / ')
    setInsetInfo({ report: getSafeAreaReport(), applied })
    setShowDev(true)
  }

  /** 进「朗读引擎参数」那一屏时现问一次引擎 —— 装了新的语音包之后这些数会变 */
  const openSpeechDev = () => {
    setTryResults({})
    setSpeechDiag(null)
    setShowSpeechDev(true)
    void diagnoseSpeech().then(setSpeechDiag)
  }

  const runTryRead = (key: string, text: string, lang: string) => {
    setTryRunning(key)
    void tryRead(text, lang)
      .then((r) => setTryResults((prev) => ({ ...prev, [key]: r })))
      .finally(() => setTryRunning(null))
  }

  /**
   * 云端试读。**这颗按钮是用户能自己查下去的唯一凭据** —— 我手上没有他的 Key，
   * 通不通我验不了，只能把服务商的原话原样交给他。
   */
  const runCloudTry = () => {
    setTryRunning('cloud')
    void tryCloudRead(cloudConfig)
      .then((r) => setTryResults((prev) => ({ ...prev, cloud: r })))
      .finally(() => setTryRunning(null))
  }

  /** 改一格存一格 —— 这几个值是粘贴进来的，不该再要一次「保存」 */
  const updateCloud = (c: CloudTtsConfig) => {
    setCloudConfig(c)
    saveCloudConfig(c)
  }

  const updateSync = (c: SyncConfig) => {
    setSyncConfig(c)
    saveSyncConfig(c)
  }

  /**
   * 进子屏之前，把主列表滚到哪儿了记下来。
   *
   * ⚠️ **必须在点下去那一刻记，不能等渲染完再读。** 这几块屏共用同一个滚动容器，
   * 一换屏内容高度就变，浏览器会当场把 scrollTop 夹回新的最大值 ——
   * 等到副作用里再读，读到的已经是夹过的数，那正是这个 bug 的成因。
   */
  const enterSub = (open: () => void) => {
    savedScroll.current = scrollRef.current?.scrollTop ?? 0
    open()
  }

  /**
   * 换屏时把滚动位置摆对。用户报的两件事其实是同一个根子：
   *
   * - **「开发者那两个点进去默认滑到最下方」** —— 那两个入口就在主列表最底下，
   *   你得滚到底才点得着，换屏时 scrollTop 原样留着，看着就像它自己滑下去了
   * - **「从子屏返回，设置就跳回顶部」** —— 子屏内容短，scrollTop 被夹成了小数，
   *   返回时那个小数还留着
   *
   * 所以：进子屏一律从头看，退回来还你原来那个位置。
   */
  const inSub =
    editingAi || editingCloud || editingSync || showAgreement || showGuide || showDev || showSpeechDev
  useLayoutEffect(() => {
    const el = scrollRef.current
    if (!el) return
    el.scrollTop = inSub ? 0 : savedScroll.current
  }, [inSub])

  /**
   * 返回键只登记一层，自己判断退到哪：在子屏里退回列表，在列表里才关掉。
   * 分成两层登记的话，AI 那屏一开一关要多一轮注册注销，没必要。
   */
  useBackHandler(open, BackPriority.settings, () => {
    if (editingAi) setEditingAi(false)
    else if (showAgreement) setShowAgreement(false)
    else if (showGuide) setShowGuide(false)
    else if (editingCloud) setEditingCloud(false)
    else if (editingSync) setEditingSync(false)
    else if (showSpeechDev) setShowSpeechDev(false)
    else if (showDev) setShowDev(false)
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
  /** 云端朗读配全了没有 —— AI 那一栏第二行据此显示「已配好的音色」还是「还没设置」 */
  const cloudOn = isCloudReady(cloudConfig)
  const inSubScreen = inSub
  const title = editingAi
    ? 'AI 设置'
    : editingCloud
    ? '云端朗读'
    : editingSync
    ? '两台设备同步'
    : showAgreement
      ? AGREEMENT_TITLE
      : showGuide
        ? '使用说明'
        : showSpeechDev
          ? '朗读引擎参数'
          : showDev
            ? '开发者'
            : '设置'
  const back = editingAi
    ? () => setEditingAi(false)
    : editingCloud
    ? () => setEditingCloud(false)
    : editingSync
    ? () => setEditingSync(false)
    : showAgreement
      ? () => setShowAgreement(false)
      : showGuide
        ? () => setShowGuide(false)
        : showSpeechDev
          ? () => setShowSpeechDev(false)
          : showDev
            ? () => setShowDev(false)
            : onClose

  const setFontSize = (size: number) =>
    onReaderSettingsChange({ ...readerSettings, fontSize: size })

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/40 kb-safe"
      onClick={back}
    >
      <div
        className="w-full max-w-md max-h-[85vh] flex flex-col bg-white rounded-2xl shadow-xl border border-paper-border"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="shrink-0 flex items-center justify-between gap-2 p-3 border-b border-paper-border">
          <span className="text-base font-semibold text-ink flex items-center gap-2 min-w-0">
            <SettingsIcon className="w-4 h-4 text-accent-600 shrink-0" />
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

        <div ref={scrollRef} className="flex-1 min-h-0 overflow-y-auto scroll-area p-3 space-y-4">
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
          ) : editingSync ? (
            <SyncPanel
              value={syncConfig}
              onChange={updateSync}
              status={syncStatus}
              onSync={onSyncNow}
            />
          ) : editingCloud ? (
            <div className="space-y-4">
              <CloudTtsPanel value={cloudConfig} onChange={updateCloud} />
            </div>
          ) : showGuide ? (
            <UserGuide />
          ) : showAgreement ? (
            <div className="space-y-2 text-xs leading-relaxed text-ink-muted">
              {AGREEMENT_CLAUSES.map((line) => (
                <p key={line}>{line}</p>
              ))}
            </div>
          ) : showSpeechDev ? (
            <SpeechReadout
              diag={speechDiag}
              results={tryResults}
              onTry={runTryRead}
              running={tryRunning}
              cloudReady={isCloudReady(cloudConfig)}
              onCloudTry={runCloudTry}
            />
          ) : showDev ? (
            <SafeAreaReadout info={insetInfo} />
          ) : (
            <>
              <Section title="上手">
                <button
                  type="button"
                  onClick={() => enterSub(() => setShowGuide(true))}
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
                  <span className="text-sm text-ink block">纸色</span>
                  <Choices
                    value={readerSettings.theme}
                    options={THEMES}
                    onPick={(t) => onReaderSettingsChange({ ...readerSettings, theme: t })}
                  />
                </div>
                <div className="space-y-1.5">
                  <span className="text-sm text-ink block">
                    强调色{' '}
                    <span className="text-ink-muted">
                      · {ACCENTS.find((a) => a.id === readerSettings.accent)?.label}
                    </span>
                  </span>
                  <AccentChoices
                    value={readerSettings.accent}
                    onPick={(a) => onReaderSettingsChange({ ...readerSettings, accent: a })}
                  />
                </div>
              </Section>

              <Section title="AI">
                <button
                  type="button"
                  onClick={() => enterSub(() => setEditingAi(true))}
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
                {/*
                  云端朗读排在 AI 下面 —— 用户要的（「把朗读那些填写放进 AI 那一栏」）。
                  两件事性质一样：都是外面的服务、都要粘一个 Key、都只存在这台手机上，
                  摆在一起找起来才顺。**这一行长得和上面那行一模一样**，点进去是单独一屏。
                */}
                <button
                  type="button"
                  onClick={() => enterSub(() => setEditingCloud(true))}
                  className="w-full flex items-center gap-2 text-left"
                >
                  <span className="flex-1 min-w-0">
                    <span className="text-sm text-ink block truncate">
                      云端朗读{cloudOn ? '' : ' · 还没设置'}
                    </span>
                    <span className="text-xs text-ink-muted block truncate">
                      {cloudOn ? `音色 ${cloudConfig.voiceType}` : '填上之后句子和生僻词才读得出来'}
                    </span>
                  </span>
                  <ChevronRight className="w-4 h-4 text-ink-muted shrink-0" />
                </button>
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
                  读过一次就存在这台手机上，之后不用联网、也没有等开口的停顿。
                  云端合成的句子也存在这里 —— 那一份还省着调用次数，同一句永远只花一次。
                  清空只是删掉存的录音，笔记一条都不会动，下次点还会重新取。
                </p>
              </Section>

              <Section title="数据">
                <button
                  type="button"
                  onClick={() => enterSub(() => setEditingSync(true))}
                  className="w-full flex items-center gap-2 text-left"
                >
                  <span className="flex-1 min-w-0">
                    <span className="block text-sm text-ink">
                      两台设备同步{isSyncReady(syncConfig) ? '' : ' · 还没设置'}
                    </span>
                    <span className="block text-xs text-ink-muted truncate">
                      {isSyncReady(syncConfig)
                        ? syncStatus.lastAt > 0
                          ? `上次同步 ${new Date(syncStatus.lastAt).toLocaleString('zh-CN')}`
                          : '还没同步过'
                        : '手机和平板通过坚果云共用同一份数据'}
                    </span>
                  </span>
                  <ChevronRight className="w-4 h-4 text-ink-muted shrink-0" />
                </button>
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

              <Section title="开发者">
                <button type="button" onClick={() => enterSub(openDev)} className="w-full flex items-center gap-2 text-left">
                  <span className="flex-1 min-w-0">
                    <span className="block text-sm text-ink">系统栏参数</span>
                    <span className="block text-xs text-ink-muted">
                      顶上和底下各让出多少、这份网页是哪一版
                    </span>
                  </span>
                  <ChevronRight className="w-4 h-4 text-ink-muted shrink-0" />
                </button>
                <button
                  type="button"
                  onClick={() => enterSub(openSpeechDev)}
                  className="w-full flex items-center gap-2 text-left"
                >
                  <span className="flex-1 min-w-0">
                    <span className="block text-sm text-ink">朗读引擎参数</span>
                    <span className="block text-xs text-ink-muted">
                      这台机器的朗读引擎认不认英文，还能当场试读
                    </span>
                  </span>
                  <ChevronRight className="w-4 h-4 text-ink-muted shrink-0" />
                </button>
              </Section>

              <Section title="关于">
                <button
                  type="button"
                  onClick={() => enterSub(() => setShowAgreement(true))}
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
