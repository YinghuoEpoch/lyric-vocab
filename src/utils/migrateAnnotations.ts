import type { Annotation, LyricPage, NotesMap, Sentence } from '../types'

/**
 * 一次性数据迁移：把旧的两套笔记合并成统一的标注表。
 *
 * 旧模型有两套并行的系统：
 * - 单词笔记 `notes`：以坐标为键（`L0W2` = 第 0 行第 2 个词），**位置即身份**
 * - 句摘 `sentences`：有自己的 id，但住在 localStorage，不在主库里
 *
 * 新模型只有一张表，每条标注有稳定的 id，位置只是它身上的一个属性。
 *
 * 这次迁移**不重新分词、不改坐标**，只是换一种方式记录同一批数据 ——
 * 坐标 `L0W2` 原样搬过去。所以它和 migrateTokenizer 那次性质不同：
 * 那次要重算位置（有算错的余地），这次纯粹是搬家（不该有任何损失）。
 * 因此本文件的硬约束是：**进去多少条，出来就是多少条**，一条不多一条不少。
 */

/** 旧模型里孤儿笔记的键前缀（见 reconcile.ts）。这里只用于识别存量数据 */
const LEGACY_ORPHAN_PREFIX = 'orphan:'

/** 解析坐标 `L0W2`。解析不出来说明它不是真坐标（例如孤儿键），返回 null */
export function parseAnchor(anchorId: string): { line: number; word: number } | null {
  const m = /^L(\d+)W(\d+)$/.exec(anchorId)
  if (!m) return null
  return { line: Number(m[1]), word: Number(m[2]) }
}

/** 一条旧单词笔记是不是孤儿：显式标记了，或者键根本不是真坐标 */
function isLegacyOrphanNote(key: string, note: { orphaned?: boolean }): boolean {
  if (note.orphaned) return true
  if (key.startsWith(LEGACY_ORPHAN_PREFIX)) return true
  return parseAnchor(key) === null
}

export interface MigrationInput {
  pages: LyricPage[]
  notes: Record<string, NotesMap>
  sentences: Sentence[]
}

export interface MigrationReport {
  /** 迁移前的条数（单词笔记 + 句摘），含孤儿 */
  before: number
  /** 迁移后的标注条数。必须等于 before */
  after: number
  wordNotes: number
  orphanWordNotes: number
  sentences: number
  orphanSentences: number
  /** 所属文档已不存在的条数（历史遗留的悬空数据）。照搬不丢，只是报个数 */
  danglingDocRefs: number
}

export interface MigrationResult {
  annotations: Annotation[]
  report: MigrationReport
}

export interface MigrationOptions {
  /** 生成 id。测试里换成可预测的实现，方便断言 */
  makeId?: () => string
  /** 单词笔记没有创建时间，用这个兜底 */
  now?: number
}

function defaultMakeId(): string {
  return Math.random().toString(36).slice(2, 12)
}

/**
 * 把旧数据整体转成标注表。
 *
 * 纯函数：不读存储、不写存储、不碰 localStorage。
 * 调用方负责把数据喂进来、把结果存回去，这样它才好测、也好在真实备份上预演。
 */
export function migrateToAnnotations(
  input: MigrationInput,
  options: MigrationOptions = {}
): MigrationResult {
  const makeId = options.makeId ?? defaultMakeId
  const now = options.now ?? Date.now()
  const knownDocs = new Set(input.pages.map((p) => p.id))

  const annotations: Annotation[] = []
  const report: MigrationReport = {
    before: 0,
    after: 0,
    wordNotes: 0,
    orphanWordNotes: 0,
    sentences: 0,
    orphanSentences: 0,
    danglingDocRefs: 0
  }

  // —— 单词笔记 ——
  for (const docId of Object.keys(input.notes)) {
    const map = input.notes[docId] ?? {}
    const keys = Object.keys(map)
    if (keys.length === 0) continue
    if (!knownDocs.has(docId)) report.danglingDocRefs += keys.length

    // 排序：有位置的按正文顺序（第几行、第几个词），孤儿排在后面并保持原有次序。
    // 这决定了复习页卡片的初始顺序，和现在看到的顺序一致。
    const positioned: Array<{ key: string; line: number; word: number }> = []
    const orphans: string[] = []
    for (const key of keys) {
      const note = map[key]
      if (!note) continue
      const at = isLegacyOrphanNote(key, note) ? null : parseAnchor(key)
      if (at) positioned.push({ key, line: at.line, word: at.word })
      else orphans.push(key)
    }
    positioned.sort((a, b) => (a.line - b.line) || (a.word - b.word))

    let order = 0
    for (const { key } of positioned) {
      const note = map[key]
      annotations.push(
        prune({
          id: makeId(),
          docId,
          type: 'word',
          start: key,
          end: key,
          text: note.word ?? '',
          order: order++,
          createdAt: now,
          phonetic: note.phonetic,
          pos: note.pos,
          definition: note.definition,
          lemma: note.lemma,
          auto: note.auto
        })
      )
      report.wordNotes++
    }
    for (const key of orphans) {
      const note = map[key]
      annotations.push(
        prune({
          id: makeId(),
          docId,
          type: 'word',
          start: null,
          end: null,
          text: note.word ?? '',
          order: order++,
          createdAt: now,
          phonetic: note.phonetic,
          pos: note.pos,
          definition: note.definition,
          lemma: note.lemma,
          auto: note.auto
        })
      )
      report.orphanWordNotes++
    }
  }

  // —— 句摘 ——
  // 按文档分组后各自从 0 开始编号，和单词一样：排序只在「同一文档、同一类型」内比较。
  // 句摘自带 id，直接沿用（这样它的身份在迁移前后是同一个）。
  // 但坏数据里可能有重复 id，撞车就等于两条笔记合成一条，所以守一下。
  const usedIds = new Set<string>()
  const byDoc = new Map<string, Sentence[]>()
  for (const s of input.sentences) {
    const list = byDoc.get(s.docId)
    if (list) list.push(s)
    else byDoc.set(s.docId, [s])
  }

  for (const [docId, list] of byDoc) {
    if (!knownDocs.has(docId)) report.danglingDocRefs += list.length
    // 句摘本来就有创建时间，按时间排；时间相同的保持原有次序
    const sorted = list
      .map((s, i) => ({ s, i }))
      .sort((a, b) => (a.s.date ?? 0) - (b.s.date ?? 0) || a.i - b.i)
      .map(({ s }) => s)

    let order = 0
    for (const s of sorted) {
      // 起止坐标本身也可能是历史遗留的坏数据，解析不出来就当孤儿处理
      const validRange =
        !s.orphaned && parseAnchor(s.startAnchorId) !== null && parseAnchor(s.endAnchorId) !== null

      const id = s.id && !usedIds.has(s.id) ? s.id : makeId()
      usedIds.add(id)

      annotations.push(
        prune({
          id,
          docId,
          type: 'sentence',
          start: validRange ? s.startAnchorId : null,
          end: validRange ? s.endAnchorId : null,
          text: s.text ?? '',
          order: order++,
          createdAt: s.date ?? now,
          grammar: s.grammar,
          meaning: s.meaning,
          auto: s.auto
        })
      )
      if (validRange) report.sentences++
      else report.orphanSentences++
    }
  }

  report.before =
    Object.values(input.notes).reduce((sum, map) => sum + Object.keys(map ?? {}).length, 0) +
    input.sentences.length
  report.after = annotations.length

  return { annotations, report }
}

/**
 * 去掉值为 undefined 的可选字段。
 * 留着的话存进 IndexedDB、导出成 JSON 都会多出一堆无意义的空键。
 */
function prune(a: Annotation): Annotation {
  const out = {} as Record<string, unknown>
  for (const [k, v] of Object.entries(a)) {
    if (v !== undefined) out[k] = v
  }
  return out as Annotation
}

/** 把报告写成一句人话，用于迁移前的预演 */
export function describeReport(r: MigrationReport): string {
  const lines = [
    `迁移前 ${r.before} 条 → 迁移后 ${r.after} 条` + (r.before === r.after ? '（0 条丢失）' : '  ⚠️ 条数对不上！'),
    `  单词笔记 ${r.wordNotes + r.orphanWordNotes} 条（其中原文已删除 ${r.orphanWordNotes} 条）`,
    `  句摘 ${r.sentences + r.orphanSentences} 条（其中原文已删除 ${r.orphanSentences} 条）`
  ]
  if (r.danglingDocRefs > 0) {
    lines.push(`  另有 ${r.danglingDocRefs} 条挂在已经不存在的文档上（历史遗留，照搬保留）`)
  }
  return lines.join('\n')
}
