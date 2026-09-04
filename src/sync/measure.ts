import type { AppData } from '../types'
import { pack, packedSize, formatSize } from './codec'
import { toIndex } from './split'

/**
 * 「同步数据有多大、都花在哪儿了」的读数。
 *
 * ## 为什么要有这一屏
 *
 * 用户问「笔记越来越多，存储占用增长快吗」。我拿交接文档里
 * **另一个数据集**的数字（1760 条笔记 17 KB）估了一遍，算出「一条约 10 字节」，
 * 结论是「两万条以内不用管」。他当场反驳：**「我才划了 300 多条，就已经 30 KB 了」**
 * —— 他是对的，我那个数差了将近一个数量级（真实是一条 50～80 字节）。
 *
 * 教训和第四十九、五十七节一模一样：**加一屏读数，胜过猜三轮。**
 * 所以这里不估算 —— 跑的是同步那套**真代码**（`toIndex` + `pack`），
 * 算出来的就是每次真正要传的那份的大小。往后他自己一眼就能看见。
 *
 * ## ⚠️ 各块相加不等于总数
 *
 * 每一块用的是「把它去掉能少多少」。gzip 是看上下文的，
 * 几块内容互相占便宜（重复的中文释义、成片的坐标），所以分开算的和会**小于**总数。
 * 这不是算错，是压缩的本性。要的是「谁是大头」，不是账目平衡。
 */

/** 一块占了多少 */
export interface SizePart {
  label: string
  bytes: number
  /** 几条、几篇这类补充说明 */
  detail: string
}

export interface NoteSize {
  kind: string
  count: number
  /** 平均一条多大（压缩后，含它自己那份 id、坐标、时间戳） */
  avgBytes: number
}

export interface SyncSizeReport {
  /** `data.json` 压缩后有多大 —— **每次同步真正要传的就是它** */
  totalBytes: number
  parts: SizePart[]
  notes: NoteSize[]
  /** 正文合计（未压缩的字符数）。单独存成 page-xxx.json，只在编辑或导入时才传 */
  contentChars: number
  bookCount: number
  pageCount: number
  noteCount: number
  /**
   * 这些东西**根本不进 data.json**，给界面单列一栏说清楚。
   *
   * ⚠️ 不能塞进 parts 里当成「占 0 字节的一块」—— 那会读成
   * 「它在里面，只是不占地方」，而事实是它压根没上云。
   */
  excluded: { label: string; detail: string }[]
}

/** 把一份数据打包成同步要传的样子，返回字节数 */
function sizeOf(value: unknown): number {
  return packedSize(pack(JSON.stringify(value)))
}

export function measureSyncData(data: AppData): SyncSizeReport {
  const index = toIndex(data) as unknown as Record<string, unknown>
  const totalBytes = sizeOf(index)

  /** 去掉某一块能少多少字节 */
  const without = (key: string): number => {
    if (index[key] === undefined) return 0
    const copy = { ...index }
    delete copy[key]
    return Math.max(0, totalBytes - sizeOf(copy))
  }

  const annotations = data.annotations ?? []

  const parts: SizePart[] = [
    { label: '笔记', bytes: without('annotations'), detail: `${annotations.length} 条` },
    { label: '文档壳', bytes: without('pages'), detail: `${(data.pages ?? []).length} 篇` },
    { label: '文库', bytes: without('books'), detail: `${(data.books ?? []).length} 个` }
  ]

  const kinds: { kind: string; type: 'word' | 'phrase' | 'sentence' }[] = [
    { kind: '单词', type: 'word' },
    { kind: '短语', type: 'phrase' },
    { kind: '句摘', type: 'sentence' }
  ]
  const notes: NoteSize[] = []
  for (const { kind, type } of kinds) {
    const list = annotations.filter((a) => a.type === type)
    if (list.length === 0) continue
    notes.push({ kind, count: list.length, avgBytes: Math.round(sizeOf(list) / list.length) })
  }

  const excluded: { label: string; detail: string }[] = []
  const legacyNotePages = Object.keys(data.notes ?? {}).length
  if (legacyNotePages > 0) {
    excluded.push({ label: '旧模型残留的老笔记表', detail: `${legacyNotePages} 篇，只留在本机` })
  }
  const readPages = (data.pages ?? []).filter((p) => typeof p.progress === 'number' && p.progress > 0)
  excluded.push({
    label: '阅读进度',
    detail: `${readPages.length} 篇，走单独的小文件`
  })

  return {
    totalBytes,
    parts: parts.sort((a, b) => b.bytes - a.bytes),
    excluded,
    notes,
    contentChars: (data.pages ?? []).reduce((s, p) => s + (p.content ?? '').length, 0),
    bookCount: (data.books ?? []).length,
    pageCount: (data.pages ?? []).length,
    noteCount: annotations.length
  }
}

/**
 * 按「一天边读边划三小时」估一个月用多少上传额度。
 *
 * ⚠️ 是**估算**，界面上要写明白。真实次数取决于他怎么用 ——
 * 每分钟至多一次那道闸是天花板（见 useSync），这里取的是个中间值。
 */
export const SYNCS_PER_DAY_ESTIMATE = 180

/** 坚果云免费账户每月上传额度（字节），用来换算百分比 */
export const FREE_UPLOAD_QUOTA = 1024 * 1024 * 1024

export function estimateMonthlyUpload(totalBytes: number): {
  bytes: number
  text: string
  percent: number
} {
  const bytes = totalBytes * SYNCS_PER_DAY_ESTIMATE * 30
  return {
    bytes,
    text: formatSize(bytes),
    percent: Math.round((bytes / FREE_UPLOAD_QUOTA) * 100)
  }
}

/** 还能再加多少条笔记，才会把免费额度吃满（按当前这批笔记的平均大小推） */
export function headroomNotes(report: SyncSizeReport): number | null {
  if (report.noteCount === 0) return null
  const perNote = report.parts.find((p) => p.label === '笔记')
  if (!perNote || perNote.bytes === 0) return null
  const avg = perNote.bytes / report.noteCount
  const budgetPerSync = FREE_UPLOAD_QUOTA / (SYNCS_PER_DAY_ESTIMATE * 30)
  const room = budgetPerSync - report.totalBytes
  return room <= 0 ? 0 : Math.round(room / avg)
}
