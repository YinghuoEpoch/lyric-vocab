// Sparkle（单数）是单个四芒星；Sparkles（复数）是一大两小，那个留给「一键填充」按钮。
// 角标要小而安静，单颗星更合适。
import { Sparkle } from 'lucide-react'

/**
 * 「这条是 AI 填的」的角标。
 *
 * 做成书里脚注那样的上标（就像 ²），紧跟在单词或句子后面，不单独占一行。
 *
 * **必须放在朗读按钮的「里面」**，不能跟在按钮后面。
 * 按钮是 inline-block，而 inline-block 是一个整块 —— 里面的文字换行之后，
 * 这个块的宽度就是整行宽，后面再没有位置放角标，角标只好掉到下一行独占一行。
 * 句子长了才会换行，所以从前只有句子卡看得出这个毛病，单词卡看不出来。
 * （把按钮改成 `display: inline` 是没用的：浏览器强制把按钮变成 inline-block，
 * 连 `!important` 都压不动。）
 * 灰色小图标，和「一键填充」按钮同一个图标，看到能联想到是那个功能填的。
 *
 * 用户手动改过之后标记会自动清掉，所以它实际上是一份「待复核清单」，
 * 复核完就自然消失，不会越积越花。
 */
export function AutoMark() {
  return (
    <span
      title="由 AI 填充，建议复核；你改动之后这个记号会自动消失"
      // leading-[0] 是要紧的：不写的话这个 span 会撑到一整行的行高（10px 的图标占出 24px），
      // 上标又是抬高的，于是每条带角标的卡片行高都被顶高 8px。
      className="inline-block align-super leading-[0] ml-0.5 text-stone-400"
      aria-label="AI 填充"
    >
      <Sparkle className="inline w-2.5 h-2.5" aria-hidden />
    </span>
  )
}
