import type { LyricPage } from './types'

/**
 * 每个文库各自的「上次读到哪一篇」。
 *
 * 用户提的场景：文库多、每个文库里文档也多，在 A 里读一篇、跳去 B 读一篇，
 * 回头想接着读 A，得在一长串文档里凭记忆找。所以给**每个文库各存一条**记录，
 * 目录里把那一篇的图标点亮 —— 相当于一个文库一枚书签。
 *
 * 「读到那一篇的第几行」不在这里，那件事本来就有（LyricPage.progress）。
 * 这里只管「哪一篇」。
 */

/** 不在任何文库里的顶层文档，也当成一个组来记，行为和文库一致 */
export const ROOT_GROUP = '__root__'

/** 组键 -> 文档 id */
export type LastReadMap = Record<string, string>

export function groupKeyOf(bookId: string | null | undefined): string {
  return bookId ?? ROOT_GROUP
}

/**
 * 记一笔：这一篇是它所在文库的「上次读到」。
 *
 * **每打开一篇就记，不等「离开」那个动作。** 两种写法看到的东西一模一样 ——
 * 人还在这个文库里的时候，当前那篇本来就整行高亮着，记号跟它重合、看不出多余的东西；
 * 一跳走记号才显出来。而「离开」是个抓不全的时机：直接退到后台、直接杀进程都没有离开事件。
 *
 * 值没变就原样返回，免得白白触发一次重渲染。
 */
export function markLastRead(map: LastReadMap, page: Pick<LyricPage, 'id' | 'bookId'>): LastReadMap {
  const key = groupKeyOf(page.bookId)
  if (map[key] === page.id) return map
  return { ...map, [key]: page.id }
}

/**
 * 这一刻该点亮哪几篇。
 *
 * **在这里当场核对，而不是在删除、移动那些地方去清表**：
 * 文档会被移进回收站、被彻底删掉、被拖到别的文库里，逐个去挂钩子迟早漏一处，
 * 漏了就是点亮一篇已经不在那儿的文档。核对的成本只有一次遍历，换的是「不可能出错」。
 *
 * 三条都得对上才算数：文档还在、没被删、而且**还在当初记下的那个文库里**。
 */
export function lastReadPageIds(map: LastReadMap, activePages: LyricPage[]): Set<string> {
  const byId = new Map(activePages.map((p) => [p.id, p]))
  const out = new Set<string>()
  for (const [key, pageId] of Object.entries(map)) {
    const page = byId.get(pageId)
    if (page && groupKeyOf(page.bookId) === key) out.add(pageId)
  }
  return out
}

/**
 * 从 localStorage 里那串字读出这张表。
 *
 * 读坏了就当没有 —— 一个书签而已，不该有把界面弄挂的能力。
 * 只认「字符串 -> 字符串」，别的形状一律丢掉。
 */
export function parseLastReadMap(raw: string | null): LastReadMap {
  if (!raw) return {}
  try {
    const parsed = JSON.parse(raw)
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return {}
    const out: LastReadMap = {}
    for (const [k, v] of Object.entries(parsed)) {
      if (typeof k === 'string' && typeof v === 'string' && k && v) out[k] = v
    }
    return out
  } catch {
    return {}
  }
}
