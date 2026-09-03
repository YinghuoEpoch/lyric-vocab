import { annotationGroupOf } from '../types'
import type { Annotation, AppData, LyricBook, LyricPage, NotesMap } from '../types'

/**
 * 两台设备的数据怎么合到一起。
 *
 * ## 为什么是「三方合并」，而不是「谁改得晚谁赢」
 *
 * 一开始想的是给每条记录加一个「最后改动时间」，再加一份「删除墓碑」，
 * 然后比时间。那要**动数据格式**，还要去二十来个写入口挨个补时间戳 ——
 * 补漏一处，那条记录就永远同步不出去，而且不会报错，只会悄悄不同步。
 *
 * 三方合并绕开了这一整摊：**本地留一份「上次同步完是什么样」（下称底本）**，
 * 于是「谁改了什么」是**算出来的**，不是记出来的：
 *
 * - 底本有、本地没有 → **我删了这条**（不需要墓碑）
 * - 底本没有、本地有 → 我加的
 * - 两边都有但不一样 → 我改过
 * - 和底本一模一样 → 我没动过
 *
 * 对面同理。于是：**只有一边动过的，听那一边的**；两边都动过才叫冲突。
 * **数据格式一个字不用改，写入口一处都不用碰。**
 *
 * ## 冲突怎么判（只有两边都动了同一条才算）
 *
 * | 情况 | 结果 | 为什么 |
 * |---|---|---|
 * | 一边删、一边改 | **保留那次修改** | 宁可留着一条你以为删了的，也别丢掉你写过的字 |
 * | 两边都删 | 删 | 没有分歧 |
 * | 两边都改，有改动时间可比 | 晚的赢 | 文档和文库有 updatedAt |
 * | 两边都改，没时间可比 | **本机赢**，并计一笔 | 标注没有改动时间。合完会告诉用户「有 N 条两边都改过，留的是本机的」 |
 *
 * 第一次同步时没有底本，当成「底本是空的」：两边的东西**全都算新增**，
 * 于是合并结果是并集 —— 正是两台已经各有数据时该有的样子。
 */

/** 合完之后发生了什么，给界面报个数 */
export interface MergeReport {
  /** 从对面拿过来的（新增或更新） */
  pulled: number
  /** 本机比对面新、要传上去的 */
  pushed: number
  /** 按「删除让位于修改」保下来的 */
  rescued: number
  /** 两边都改了同一条、只能取一个的 */
  conflicts: number
}

export function emptyReport(): MergeReport {
  return { pulled: 0, pushed: 0, rescued: 0, conflicts: 0 }
}

/** 一条记录在某一侧的状态：在（带内容）或者不在 */
type Side<T> = { has: true; value: T } | { has: false }

function sideOf<T>(map: Map<string, T>, id: string): Side<T> {
  const v = map.get(id)
  return v === undefined ? { has: false } : { has: true, value: v }
}

/** 内容一样不一样。JSON 比较够用：这些都是纯数据，字段顺序由同一套代码产生，稳定 */
function same(a: unknown, b: unknown): boolean {
  return JSON.stringify(a) === JSON.stringify(b)
}

/** 和底本比，这一侧动过没有 */
function changed<T>(base: Side<T>, side: Side<T>): boolean {
  if (base.has !== side.has) return true
  if (!base.has || !side.has) return false
  return !same(base.value, side.value)
}

/**
 * 一族记录的三方合并。三个集合都按 id 索引。
 *
 * `newerOf` 用来在「两边都改了同一条」时挑一个：
 * 返回 'local' 或 'remote'。给不出答案（没有可比的时间）就返回 null，
 * 那时按「本机赢」处理，并记一笔冲突。
 */
export function mergeById<T>(
  base: Map<string, T>,
  local: Map<string, T>,
  remote: Map<string, T>,
  report: MergeReport,
  newerOf?: (a: T, b: T) => 'local' | 'remote' | null
): Map<string, T> {
  const out = new Map<string, T>()
  const ids = new Set<string>([...base.keys(), ...local.keys(), ...remote.keys()])

  for (const id of ids) {
    const b = sideOf(base, id)
    const l = sideOf(local, id)
    const r = sideOf(remote, id)
    const localChanged = changed(b, l)
    const remoteChanged = changed(b, r)

    // 谁都没动：原样留着（两边应该一致，取本地那份）
    if (!localChanged && !remoteChanged) {
      if (l.has) out.set(id, l.value)
      continue
    }

    // 只有对面动过：听对面的
    if (!localChanged && remoteChanged) {
      if (r.has) {
        out.set(id, r.value)
        report.pulled++
      }
      continue
    }

    // 只有本机动过：听本机的
    if (localChanged && !remoteChanged) {
      if (l.has) {
        out.set(id, l.value)
        report.pushed++
      }
      continue
    }

    // 两边都动过 ——
    // 一边删了、另一边改了：**保留那次修改**。
    // 删掉的东西还能再删一次，写过的字丢了就没了
    if (!l.has && r.has) {
      out.set(id, r.value)
      report.rescued++
      report.pulled++
      continue
    }
    if (l.has && !r.has) {
      out.set(id, l.value)
      report.rescued++
      report.pushed++
      continue
    }
    // 两边都删了：没有分歧
    if (!l.has && !r.has) continue

    // 两边都改了同一条
    if (l.has && r.has) {
      if (same(l.value, r.value)) {
        out.set(id, l.value)
        continue
      }
      const winner = newerOf?.(l.value, r.value) ?? null
      if (winner === 'remote') {
        out.set(id, r.value)
        report.pulled++
      } else {
        out.set(id, l.value)
        report.pushed++
      }
      // 有时间可比的不算「说不清的冲突」，只有靠「本机优先」定下来的才算
      if (winner === null) report.conflicts++
    }
  }

  return out
}

/**
 * 和底本比，**除了阅读进度以外什么都没变**吗。
 *
 * ⚠️ 这是流量的头号大户，值得单拎出来。你一路往下读，滚动位置一直在存
 * （LyricPage.progress），每一次都算「数据变了」，于是自动同步就要传一整份上去 ——
 * 而那一份是整本整本的小说，好几兆。读一天书能把一个月的免费额度读光。
 *
 * 治法不是不同步进度（换设备接着读那一行是有用的），而是**不让它单独触发上传**：
 * 只要有别的东西变了，进度就顺路一起传走；只有它自己变，就等着。
 *
 * 手动那颗按钮不看这个 —— 人明确要同步时，进度也该立刻传上去。
 */
export function onlyProgressChanged(base: AppData, local: AppData): boolean {
  const strip = (d: AppData) => ({
    ...d,
    pages: (d.pages ?? []).map(({ progress: _progress, ...rest }) => rest)
  })
  const a = JSON.stringify(strip(base))
  const b = JSON.stringify(strip(local))
  if (a !== b) return false
  // 去掉进度之后完全一样：那么要么进度也没变（不该走到这儿），要么变的只有进度
  return JSON.stringify(base) !== JSON.stringify(local)
}

/**
 * 三方合并「**顺序**」。
 *
 * ⚠️ 用户问出来的：「要是文档文库的排序变了，这个又会怎么样」——
 * 会被悄悄还原。因为**顺序是数组位置表达的，不是存一个字段**
 * （见 storage.ts 的 reorderBooks / reorderPages），
 * 而按 id 建表再吐出来的合并天然不认识「位置」：拖动之后每条记录**内容都没变**，
 * 合并只会说「谁都没动过」，然后按底本的次序吐出来 —— 你那一下白拖了。
 *
 * 判断「谁拖过」时**只比两边都有的那些 id**：
 * 否则「删了一篇」「加了一篇」都会被误判成拖动过。
 *
 * 取舍和别处一致：只有一边拖过就听那一边的，两边都拖过本机赢。
 */
export function mergeOrder(
  baseIds: readonly string[],
  localIds: readonly string[],
  remoteIds: readonly string[],
  surviving: ReadonlySet<string>
): string[] {
  /** 只留两边都有的那些，再比次序 —— 增删不该被当成拖动 */
  const common = (a: readonly string[], b: readonly string[]) => {
    const inB = new Set(b)
    return a.filter((id) => inB.has(id))
  }
  const moved = (side: readonly string[]) =>
    common(side, baseIds).join() !== common(baseIds, side).join()

  const chosen = moved(localIds) ? localIds : moved(remoteIds) ? remoteIds : baseIds

  const out: string[] = []
  const used = new Set<string>()
  for (const id of chosen) {
    if (surviving.has(id) && !used.has(id)) {
      out.push(id)
      used.add(id)
    }
  }
  // 选中那条次序里没提到的（新加的），按「本机先、对面后」补在后面
  for (const id of [...localIds, ...remoteIds]) {
    if (surviving.has(id) && !used.has(id)) {
      out.push(id)
      used.add(id)
    }
  }
  return out
}

/** 按给定的 id 次序把记录排好 */
function inOrder<T extends { id: string }>(map: Map<string, T>, order: readonly string[]): T[] {
  const out: T[] = []
  for (const id of order) {
    const v = map.get(id)
    if (v) out.push(v)
  }
  return out
}

/**
 * 复习页卡片的排序，按「同一文档、同一类型」一组一组地合。
 *
 * ⚠️ **为什么不能逐条合。** 卡片顺序是每条记录上的 `order` 字段，
 * 逐条合看着能work，实际会**交错**：本机把 A 挪到最后、对面把 B 挪到最前，
 * 逐条各取各的，最后两张卡可能都编号 0 —— 排出一个**谁都没要过的乱序**。
 * 用户追问「复习模式下的卡片也有排序功能，这个有考虑到吗」时，
 * 测试当场把这个抓出来了。
 *
 * 所以整组取一边的次序，规矩和文库文档那边一致：
 * 只有一边动过就听那一边的，两边都动过本机赢。合完**重新编号 0..n-1**，
 * 顺手把历史遗留的重复编号也抹平了。
 */
export function mergeCardOrder(
  base: readonly Annotation[],
  local: readonly Annotation[],
  remote: readonly Annotation[],
  survivors: Map<string, Annotation>
): Map<string, Annotation> {
  const key = (a: Annotation) => `${a.docId}|${annotationGroupOf(a.type)}`
  const seq = (list: readonly Annotation[], k: string) =>
    list
      .filter((a) => key(a) === k)
      .slice()
      .sort((x, y) => x.order - y.order)
      .map((a) => a.id)

  const groups = new Set<string>()
  for (const a of survivors.values()) groups.add(key(a))

  const out = new Map(survivors)
  for (const k of groups) {
    const alive = new Set(
      [...survivors.values()].filter((a) => key(a) === k).map((a) => a.id)
    )
    const order = mergeOrder(seq(base, k), seq(local, k), seq(remote, k), alive)
    order.forEach((id, i) => {
      const a = out.get(id)
      if (a && a.order !== i) out.set(id, { ...a, order: i })
    })
  }
  return out
}

function byId<T extends { id: string }>(list: readonly T[] | undefined): Map<string, T> {
  return new Map((list ?? []).map((x) => [x.id, x]))
}

/** 按「最后改动时间」挑晚的。两个数一样大时返回 null —— 分不出就是分不出 */
function byUpdatedAt<T extends { updatedAt?: number }>(l: T, r: T): 'local' | 'remote' | null {
  const a = l.updatedAt ?? 0
  const b = r.updatedAt ?? 0
  if (a === b) return null
  return a > b ? 'local' : 'remote'
}

/**
 * 合并两份完整数据。
 *
 * ⚠️ **标注（划词、短语、句摘）没有「最后改动时间」**，所以两边都改了同一条时
 * 分不出谁晚 —— 按「本机赢」，并计入 conflicts 让界面告诉用户。
 * 这不是偷懒：给标注补时间戳要动数据格式和二十来个写入口，
 * 而这种冲突（两台设备都改了同一条笔记的释义）本来就极少见。
 * 真遇上了再说，那时也有 conflicts 这个数当依据。
 */
export function mergeAppData(
  base: AppData | null,
  local: AppData,
  remote: AppData
): { merged: AppData; report: MergeReport } {
  const report = emptyReport()
  const b = base ?? { books: [], pages: [], notes: {} }

  const books = mergeById<LyricBook>(byId(b.books), byId(local.books), byId(remote.books), report)
  const pages = mergeById<LyricPage>(
    byId(b.pages),
    byId(local.pages),
    byId(remote.pages),
    report,
    byUpdatedAt
  )
  const annotationsById = mergeById<Annotation>(
    byId(b.annotations),
    byId(local.annotations),
    byId(remote.annotations),
    report
  )
  // 卡片顺序整组合一遍，逐条合会交错成乱序 —— 见 mergeCardOrder
  const annotations = mergeCardOrder(
    b.annotations ?? [],
    local.annotations ?? [],
    remote.annotations ?? [],
    annotationsById
  )

  // 旧模型的 notes 是「文档 id -> 一堆笔记」的表。运行期已经不写它了
  // （见 types.ts 的说明），但恢复老备份还得靠它，所以照样按 id 合一遍
  const notes = mergeById<NotesMap>(
    new Map(Object.entries(b.notes ?? {})),
    new Map(Object.entries(local.notes ?? {})),
    new Map(Object.entries(remote.notes ?? {})),
    report
  )

  /*
   * 顺序单独合一遍。**必须在按 id 合完之后做** —— 先要知道哪些活下来了，
   * 才谈得上把它们排成什么次序。
   */
  const bookOrder = mergeOrder(
    (b.books ?? []).map((x) => x.id),
    (local.books ?? []).map((x) => x.id),
    (remote.books ?? []).map((x) => x.id),
    new Set(books.keys())
  )
  const pageOrder = mergeOrder(
    (b.pages ?? []).map((x) => x.id),
    (local.pages ?? []).map((x) => x.id),
    (remote.pages ?? []).map((x) => x.id),
    new Set(pages.keys())
  )

  const merged: AppData = {
    books: inOrder(books, bookOrder),
    pages: inOrder(pages, pageOrder),
    annotations: [...annotations.values()],
    notes: Object.fromEntries(notes),
    // 迁移标记取大的：任意一台跑过迁移，就不该再跑第二遍
    annotationsMigratedAt: Math.max(
      local.annotationsMigratedAt ?? 0,
      remote.annotationsMigratedAt ?? 0
    ) || undefined
  }

  return { merged, report }
}
