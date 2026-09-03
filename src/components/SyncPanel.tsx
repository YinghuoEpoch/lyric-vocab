import { useState } from 'react'
import { Eye, EyeOff } from 'lucide-react'
import type { SyncConfig } from '../sync'
import type { SyncStatus } from '../hooks/useSync'

/**
 * 设置里填坚果云凭证、以及手动同步一次的地方。
 *
 * 和云端朗读那一屏一个路子：**这里不验证对不对**，
 * 填完点「立刻同步一次」，把服务器的原话打在屏上 ——
 * 我手上没有用户的账号，那条网络路我验不了，只能把原话交给他自己判断
 * （云端朗读那次就是靠这一招定的案）。
 */
export function SyncPanel({
  value,
  onSave,
  onCancel,
  status,
  onSync
}: {
  value: SyncConfig
  onSave: (c: SyncConfig) => void
  onCancel: () => void
  status: SyncStatus
  onSync: () => void
}) {
  /**
   * 改动先落在草稿里，**点了保存才算数**（用户要求，和 AI 设置那一屏对齐）。
   * 这几格是粘贴进来的长串，手一抖改坏了又没有撤销，只能回坚果云再复制一遍。
   */
  const [draft, setDraft] = useState<SyncConfig>(value)
  const dirty = JSON.stringify(draft) !== JSON.stringify(value)
  /**
   * 应用密码默不默认遮住，按**框里有没有东西**决定，不跟着动作走。
   * 这是这个项目定过的规矩（第四十节）：一律遮住会撞上「安卓密码框不给粘贴」那个老坑，
   * 而这一格恰恰是要从坚果云那边粘贴过来的。
   */
  const [showPwd, setShowPwd] = useState(value.password.trim() === '')

  const set = (patch: Partial<SyncConfig>) => setDraft((d) => ({ ...d, ...patch }))
  const field =
    'w-full px-2.5 py-1.5 text-sm rounded-lg border border-paper-border bg-white text-ink focus:outline-none focus:ring-2 focus:ring-accent-500/30 focus:border-accent-500'

  const r = status.report

  return (
    <div className="space-y-2.5">
      <label className="block space-y-1">
        <span className="text-xs text-ink-muted">坚果云账号（邮箱）</span>
        <input
          type="text"
          value={draft.username}
          onChange={(e) => set({ username: e.target.value })}
          placeholder="you@example.com"
          className={field}
          autoComplete="off"
        />
      </label>

      <label className="block space-y-1">
        <span className="text-xs text-ink-muted">应用密码（不是登录密码）</span>
        <div className="relative">
          <input
            type={showPwd ? 'text' : 'password'}
            value={draft.password}
            onChange={(e) => set({ password: e.target.value })}
            placeholder="坚果云「第三方应用管理」里生成的那一串"
            className={`${field} pr-9`}
            autoComplete="off"
          />
          <button
            type="button"
            onClick={() => setShowPwd((v) => !v)}
            aria-label={showPwd ? '遮住密码' : '显示密码'}
            className="absolute right-1.5 top-1/2 -translate-y-1/2 p-1 rounded text-ink-muted hover:bg-stone-100"
          >
            {showPwd ? <Eye className="w-4 h-4" /> : <EyeOff className="w-4 h-4" />}
          </button>
        </div>
      </label>

      <label className="block space-y-1">
        <span className="text-xs text-ink-muted">放在哪个文件夹</span>
        <input
          type="text"
          value={draft.folder}
          onChange={(e) => set({ folder: e.target.value })}
          placeholder="我的坚果云"
          className={field}
          autoComplete="off"
        />
        <span className="block text-xs text-ink-muted leading-relaxed">
          ⚠️ 这个文件夹必须在坚果云里已经存在，app 建不出来（手机上那套网络库不支持建文件夹）。
          最省事的是直接填坚果云默认就有的那个：「我的坚果云」。
        </span>
      </label>

      <div className="flex gap-2 pt-1">
        <button
          type="button"
          className="h-9 px-3 rounded-lg border border-stone-300 text-stone-600 text-sm hover:bg-stone-50"
          onClick={onCancel}
        >
          取消
        </button>
        <button
          type="button"
          disabled={!dirty}
          className="flex-1 h-9 rounded-lg bg-accent-600 hover:bg-accent-700 disabled:opacity-40 text-white text-sm font-medium"
          onClick={() => onSave(draft)}
        >
          {dirty ? '保存' : '已保存'}
        </button>
      </div>

      {/* 同步用的是**存下来的**那一份，不是草稿 —— 所以还没保存时先拦一下，别让人白等 */}
      {dirty ? (
        <p className="px-1 text-xs text-ink-muted">改了还没保存，先点「保存」再同步。</p>
      ) : null}

      <button
        type="button"
        onClick={onSync}
        disabled={status.state === 'syncing' || dirty}
        className="w-full px-3 py-2 rounded-lg border border-accent-300 bg-accent-50 text-sm text-accent-900 disabled:opacity-50"
      >
        {status.state === 'syncing' ? '正在同步…' : '立刻同步一次'}
      </button>

      {status.state === 'error' && status.error ? (
        <p className="px-1 text-xs leading-relaxed break-all text-rose-600">{status.error}</p>
      ) : null}

      {status.state === 'ok' && r ? (
        <p className="px-1 text-xs leading-relaxed text-emerald-700">
          同步好了。
          {r.pulled === 0 && r.pushed === 0
            ? '两边本来就是一样的。'
            : `拿回来 ${r.pulled} 条，传上去 ${r.pushed} 条。`}
          {r.rescued > 0 ? `其中 ${r.rescued} 条是「一边删了一边改了」，保留了那次修改。` : ''}
          {r.conflicts > 0
            ? `另有 ${r.conflicts} 条两边都改过、又分不出谁晚，留的是这台机器上的。`
            : ''}
        </p>
      ) : null}

      <p className="text-xs text-ink-muted leading-relaxed">
        {status.lastAt > 0
          ? `上次同步：${new Date(status.lastAt).toLocaleString('zh-CN')}`
          : '还没同步过'}
      </p>

      <p className="text-xs text-ink-muted leading-relaxed">
        填好之后就不用管了：回到 app 的时候自动拉一次，改完东西过几秒自动传一次。
        两台设备各加各的都会保留；只有两边改了同一条才需要取舍，取舍结果上面会报给你。
        发音录音不同步 —— 那是丢了能重下的东西，没必要占你的网盘。
      </p>
    </div>
  )
}
