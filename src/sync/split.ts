import type { AppData, LyricPage } from '../types'

/**
 * 把「正文」和「其它一切」拆开存。
 *
 * ## 为什么要拆
 *
 * 量出来的（第六十二节）：八本书的库，压缩后 1.44 MB，其中**正文占 1.42 MB**，
 * 而**索引加上全部 1760 条笔记只有 17 KB**。
 *
 * 用户划一个词，改的是那 17 KB 里的一条，而原先要把 1.44 MB 整个重传一遍 ——
 * **97% 的流量花在重传一个字都没变的小说上**。他自己算出这一点并要求拆开。
 *
 * 拆开之后：
 *
 * - `data.json` —— 索引：文库、文档的**壳**（标题、所属、进度……但没有正文）、
 *   全部笔记。划词改的就是它，17 KB
 * - `page-<id>.json` —— 每篇正文一个文件。**只在编辑正文或导入新书时才动**
 *
 * 省 84 倍。
 *
 * ## ⚠️ 为什么文件名是 `page-xxx` 而不是放进 `pages/` 子目录
 *
 * 因为**建不出子目录**：CapacitorHttp 不支持 MKCOL（第六十一节的坑）。
 * 所有文件只能平铺在用户手工建的那一个文件夹里。
 *
 * ## ⚠️ 为什么要内容指纹，不能用 updatedAt
 *
 * `savePage` 每次都刷新 `updatedAt`，**连只存了滚动位置的那一次也刷**。
 * 拿它判断「正文变没变」会把大量没变的正文误判成变了，等于白拆。
 */

/** 文档在索引里的样子：把正文换成一枚指纹 */
export type PageMeta = Omit<LyricPage, 'content'> & { contentRev: string }

/** 索引：和 AppData 一样，只是 pages 里没有正文 */
export interface SyncIndex extends Omit<AppData, 'pages'> {
  pages: PageMeta[]
}

/**
 * 内容指纹（FNV-1a 32 位）。
 *
 * 不用加密级的哈希：这里只要回答「这两段是不是同一段」。
 * 撞车的后果是**把一次正文改动当成没改**，概率是四十亿分之一，
 * 而且下一次真改动就会纠正过来 —— 为这个换一个慢十倍的算法不值。
 * 长度也拼进去，白捡一层保险。
 */
export function contentRev(content: string): string {
  let h = 0x811c9dc5
  for (let i = 0; i < content.length; i++) {
    h ^= content.charCodeAt(i)
    h = Math.imul(h, 0x01000193)
  }
  return `${(h >>> 0).toString(36)}-${content.length.toString(36)}`
}

/** 完整数据 -> 索引（正文换成指纹） */
export function toIndex(data: AppData): SyncIndex {
  return {
    ...data,
    pages: (data.pages ?? []).map(({ content, ...rest }) => ({
      ...rest,
      contentRev: contentRev(content ?? '')
    }))
  }
}

/** 从完整数据里把「文档 id -> 正文」抽出来 */
export function contentsOf(data: AppData): Map<string, string> {
  return new Map((data.pages ?? []).map((p) => [p.id, p.content ?? '']))
}

/**
 * 索引 + 正文 -> 完整数据。
 *
 * 取不到正文的文档给一个空字符串而不是丢掉它：
 * **宁可显示成一篇空文档，也不能让它从文库里消失** ——
 * 前者一眼看得出不对、下次同步还会补回来，后者用户会以为自己的书没了。
 */
export function fromIndex(index: SyncIndex, contents: Map<string, string>): AppData {
  return {
    ...index,
    pages: index.pages.map(({ contentRev: _rev, ...rest }) => ({
      ...rest,
      content: contents.get(rest.id) ?? ''
    }))
  }
}

/**
 * 合并完之后，哪几篇的正文要**下载**（本地手上那份不是合并结果要的那一版）。
 *
 * 只看指纹对不对得上，不下载就无从比较 —— 这正是拆开的意义：
 * 没变的那些一个字节都不用走。
 */
export function pagesToDownload(merged: SyncIndex, localContents: Map<string, string>): string[] {
  const out: string[] = []
  for (const p of merged.pages) {
    const local = localContents.get(p.id)
    if (local === undefined || contentRev(local) !== p.contentRev) out.push(p.id)
  }
  return out
}

/**
 * 哪几篇的正文要**上传**（云端那边和合并结果对不上）。
 *
 * 云端索引里没有这一篇（新加的、或者从别处导入的）也算，
 * 否则那篇书传上去只有壳没有正文。
 */
export function pagesToUpload(merged: SyncIndex, remote: SyncIndex | null): string[] {
  const remoteRev = new Map((remote?.pages ?? []).map((p) => [p.id, p.contentRev]))
  return merged.pages.filter((p) => remoteRev.get(p.id) !== p.contentRev).map((p) => p.id)
}

/** 云端上哪几篇正文已经没人要了（文档被彻底删掉），可以顺手清掉 */
export function orphanPages(merged: SyncIndex, remote: SyncIndex | null): string[] {
  const alive = new Set(merged.pages.map((p) => p.id))
  return (remote?.pages ?? []).map((p) => p.id).filter((id) => !alive.has(id))
}

/**
 * 云端那份是不是**旧格式**（一整块、正文就在里面）。
 *
 * ⚠️ 必须认得出来：用户云端已经有一份旧格式的，
 * 读不出来就等于把他同步上去的东西弄丢。认出来之后照样能用 ——
 * 正文直接从那一份里取，下一次写回去时自动变成新格式。
 */
export function looksLikeLegacy(parsed: unknown): boolean {
  const pages = (parsed as { pages?: unknown } | null)?.pages
  if (!Array.isArray(pages) || pages.length === 0) return false
  return pages.some((p) => typeof (p as { content?: unknown })?.content === 'string')
}
