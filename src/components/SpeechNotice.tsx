import { X } from 'lucide-react'

/**
 * 朗读失败时的那一条提示。
 *
 * **三处共用**（阅读页、右侧生词板、复习页）。从前只有复习页画它，另外两处把
 * `useSpeak()` 返回的 error 整个丢掉了 —— 于是用户在阅读页长按一个词，
 * 没声音、也没有任何交代，就是纯粹的「点了没用」。
 * 用户的平板上正是这样，害我们多绕了好几轮（见 后续规划.md 第五十七节）。
 *
 * 「去安装」只在**确实是缺语音包**的时候给：那颗键跳的是系统的语音包安装页，
 * 而压根没有引擎的设备连那个页面都没有，给了也是骗人。
 */
export function SpeechNotice({
  error,
  onInstall,
  onDismiss
}: {
  error: { message: string; missingVoice: boolean } | null
  onInstall: (() => void) | null
  onDismiss: () => void
}) {
  if (!error) return null
  return (
    <div className="shrink-0 flex items-start gap-2 px-4 py-2 bg-accent-50 border-b border-accent-200 text-xs text-accent-900 leading-relaxed">
      <span className="flex-1 break-words">{error.message}</span>
      {error.missingVoice && onInstall && (
        <button
          type="button"
          onClick={onInstall}
          className="shrink-0 px-2 py-0.5 rounded border border-accent-300 hover:bg-accent-100 font-medium"
        >
          去安装
        </button>
      )}
      <button
        type="button"
        onClick={onDismiss}
        aria-label="知道了"
        className="p-0.5 rounded hover:bg-accent-100 shrink-0"
      >
        <X className="w-3.5 h-3.5" />
      </button>
    </div>
  )
}
