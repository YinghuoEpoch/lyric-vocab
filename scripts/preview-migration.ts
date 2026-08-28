/**
 * 迁移预演：拿一份真实的备份 JSON 跑一遍标注迁移，只看结果、不写任何东西。
 *
 * 目的是在真正动数据之前，用你自己的数据回答一个问题：
 * 「进去多少条，出来多少条，有没有丢。」
 *
 * 用法（先在 App 里「导出备份」拿到 JSON 文件）：
 *
 *   node scripts/preview-migration.ts "文库备份-2026-08-29.json"
 *
 * 加 --dump 还会把转换后的前几条打印出来，方便肉眼核对。
 */
import { readFileSync } from 'node:fs'
import { migrateToAnnotations, describeReport } from '../src/utils/migrateAnnotations.ts'

const args = process.argv.slice(2)
const dump = args.includes('--dump')
const file = args.find((a) => !a.startsWith('--'))

if (!file) {
  console.error('用法: node scripts/preview-migration.ts <备份.json> [--dump]')
  process.exit(1)
}

const raw = JSON.parse(readFileSync(file, 'utf8'))

const input = {
  pages: Array.isArray(raw.pages) ? raw.pages : [],
  notes: raw.notes && typeof raw.notes === 'object' ? raw.notes : {},
  sentences: Array.isArray(raw.sentences) ? raw.sentences : []
}

console.log('备份文件：', file)
console.log(`文库 ${Array.isArray(raw.books) ? raw.books.length : 0} 个，文档 ${input.pages.length} 篇`)
console.log('')

const { annotations, report } = migrateToAnnotations(input)

console.log(describeReport(report))
console.log('')

// 逐文档核对：每篇文档迁移前后各有多少条
const beforeByDoc = new Map<string, number>()
for (const [docId, map] of Object.entries(input.notes)) {
  beforeByDoc.set(docId, Object.keys(map ?? {}).length)
}
for (const s of input.sentences) {
  beforeByDoc.set(s.docId, (beforeByDoc.get(s.docId) ?? 0) + 1)
}

const afterByDoc = new Map<string, number>()
for (const a of annotations) {
  afterByDoc.set(a.docId, (afterByDoc.get(a.docId) ?? 0) + 1)
}

const titleOf = new Map<string, string>(input.pages.map((p: { id: string; title: string }) => [p.id, p.title]))
let mismatch = 0
for (const [docId, before] of beforeByDoc) {
  const after = afterByDoc.get(docId) ?? 0
  if (before !== after) {
    mismatch++
    console.log(`  ⚠️ ${titleOf.get(docId) ?? docId}: ${before} → ${after}`)
  }
}
console.log(mismatch === 0 ? '逐篇核对：每一篇文档的条数都对得上。' : `逐篇核对：有 ${mismatch} 篇对不上，见上。`)

// 内容抽查：随便挑几条，看字段有没有搬全
if (dump) {
  console.log('')
  console.log('前 5 条标注：')
  for (const a of annotations.slice(0, 5)) console.log(' ', JSON.stringify(a))
  const orphans = annotations.filter((a) => a.start === null)
  if (orphans.length) {
    console.log('原文已删除的（前 3 条）：')
    for (const a of orphans.slice(0, 3)) console.log(' ', JSON.stringify(a))
  }
}

process.exit(report.before === report.after && mismatch === 0 ? 0 : 1)
