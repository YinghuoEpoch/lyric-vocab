// Sparkle（单数）是单个四芒星；Sparkles（复数）是一大两小，那个留给「一键填充」按钮。
// 角标要小而安静，单颗星更合适。
import { Sparkle } from 'lucide-react'

/**
 * 「这条是 AI 填的」的角标。
 *
 * 做成书里脚注那样的上标（就像 ²），紧跟在单词或句子后面，不单独占一行。
 * 灰色小图标，和「一键填充」按钮同一个图标，看到能联想到是那个功能填的。
 *
 * 用户手动改过之后标记会自动清掉，所以它实际上是一份「待复核清单」，
 * 复核完就自然消失，不会越积越花。
 */
export function AutoMark() {
  return (
    <span
      title="由 AI 填充，建议复核；你改动之后这个记号会自动消失"
      className="inline-block align-super ml-0.5 text-stone-400"
      aria-label="AI 填充"
    >
      <Sparkle className="inline w-2.5 h-2.5" aria-hidden />
    </span>
  )
}
