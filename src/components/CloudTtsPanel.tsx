import { useState } from 'react'
import { Eye, EyeOff } from 'lucide-react'
import { getCloudCalls, resetCloudCalls, type CloudTtsConfig } from '../speech/cloudTts'

/**
 * 设置里填云端朗读凭证的地方。
 *
 * 只有三格半：应用 ID、令牌、音色，外加一格集群（有默认值，一般不用动）。
 * **这里不验证对不对** —— 验证在「开发者 → 朗读引擎参数 → 云端试读」，
 * 那儿会把服务商的原话打在屏上。分开是有意的：填的时候联网试探很烦，
 * 而真出问题时要的是原始报错，不是一句「保存失败」。
 */
export function CloudTtsPanel({
  value,
  onChange
}: {
  value: CloudTtsConfig
  onChange: (c: CloudTtsConfig) => void
}) {
  /**
   * 令牌默不默认遮住，按**框里有没有东西**决定，不跟着动作走。
   *
   * 这条是这个项目定过的规矩（见 后续规划.md 第四十节）：一律遮住会撞上
   * 「安卓密码框不给粘贴」那个老坑 —— 而这一格恰恰是要粘贴进来的。
   */
  const [showToken, setShowToken] = useState(value.token.trim() === '')
  /** 这台机器上真发出去过多少次。进这一屏时读一次就够 */
  const [calls, setCalls] = useState(getCloudCalls)

  const set = (patch: Partial<CloudTtsConfig>) => onChange({ ...value, ...patch })
  const field = 'w-full px-2.5 py-1.5 text-sm rounded-lg border border-paper-border bg-white text-ink focus:outline-none focus:ring-2 focus:ring-accent-500/30 focus:border-accent-500'

  return (
    <div className="space-y-2.5">
      <label className="block space-y-1">
        <span className="text-xs text-ink-muted">应用 ID（APPID）</span>
        <input
          type="text"
          value={value.appid}
          onChange={(e) => set({ appid: e.target.value })}
          placeholder="控制台里那串数字"
          className={field}
          autoComplete="off"
        />
      </label>

      <label className="block space-y-1">
        <span className="text-xs text-ink-muted">访问令牌（Access Token）</span>
        <div className="relative">
          <input
            type={showToken ? 'text' : 'password'}
            value={value.token}
            onChange={(e) => set({ token: e.target.value })}
            placeholder="粘贴进来"
            className={`${field} pr-9`}
            autoComplete="off"
          />
          <button
            type="button"
            onClick={() => setShowToken((v) => !v)}
            aria-label={showToken ? '遮住令牌' : '显示令牌'}
            className="absolute right-1.5 top-1/2 -translate-y-1/2 p-1 rounded text-ink-muted hover:bg-stone-100"
          >
            {/* 图标跟**当前状态**走，不跟动作走 —— 反过来是第四十节修过的一个错 */}
            {showToken ? <Eye className="w-4 h-4" /> : <EyeOff className="w-4 h-4" />}
          </button>
        </div>
      </label>

      <label className="block space-y-1">
        <span className="text-xs text-ink-muted">音色（voice_type）</span>
        <input
          type="text"
          value={value.voiceType}
          onChange={(e) => set({ voiceType: e.target.value })}
          placeholder="BV001_streaming"
          className={field}
          autoComplete="off"
        />
      </label>

      <label className="block space-y-1">
        <span className="text-xs text-ink-muted">服务集群（一般不用改）</span>
        <input
          type="text"
          value={value.cluster}
          onChange={(e) => set({ cluster: e.target.value })}
          placeholder="volcano_tts"
          className={field}
          autoComplete="off"
        />
      </label>

      <div className="flex items-center justify-between gap-2 pt-1">
        <span className="flex-1 min-w-0 text-sm text-ink">
          这台机器上已经用掉 {calls} 次
        </span>
        <button
          type="button"
          onClick={() => {
            resetCloudCalls()
            setCalls(0)
          }}
          className="shrink-0 px-2.5 py-1 text-xs rounded-lg border border-paper-border hover:bg-stone-100 text-ink-muted"
        >
          归零
        </button>
      </div>
      <p className="text-xs text-ink-muted leading-relaxed">
        这个数是 app 自己数的，只数真发出去的那些 —— 读过一遍存下来的句子再点不算，
        因为它压根没联网、也不扣额度。官网的用量是延迟统计的，刚用完往往看不出变化，
        对不上的时候以这儿为准。想和官网对齐就按「归零」。
      </p>
      <p className="text-xs text-ink-muted leading-relaxed">
        填好之后去「开发者 → 朗读引擎参数」点一下「云端试读」，那儿会把服务商的原话显示出来，
        对不对一眼就知道。留空则不用云端，照旧只有真人录音和这台机器的引擎。
      </p>
    </div>
  )
}
