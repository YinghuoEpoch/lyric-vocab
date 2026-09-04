import { describe, it, expect } from 'vitest'
import type { Annotation, AppData } from '../types'
import { measureSyncData, estimateMonthlyUpload, headroomNotes } from './measure'

/**
 * 「同步数据有多大」读数的回归测试。
 *
 * 这一屏存在的意义就是**别再猜**（我猜错过一次，差了将近一个数量级）。
 * 所以最要紧的性质只有一条：**它报的必须是真算出来的，会随数据变**，
 * 而不是某个写死的估计值。
 */

const 词 = (i: number): Annotation => ({
  id: `w${i}`,
  docId: 'p1',
  type: 'word',
  start: `L${i}W0`,
  end: `L${i}W0`,
  text: 'stumble',
  createdAt: 1788500000000 + i,
  phonetic: "/'stʌmbl/",
  pos: 'v.',
  definition: '绊倒；跌跌撞撞'
})

const 句 = (i: number): Annotation => ({
  id: `s${i}`,
  docId: 'p1',
  type: 'sentence',
  start: `L${i}W0`,
  end: `L${i}W8`,
  text: 'And all the stories inside me feel like bursting at the seams',
  createdAt: 1788500000000 + i,
  grammar: '比较状语从句，feel like 后接动名词',
  meaning: '而我心中的所有故事，仿佛要冲破胸膛、满溢而出'
})

const 造 = (over: Partial<AppData> = {}): AppData => ({
  books: [{ id: 'b1', name: '示例文库', createdAt: 1 }] as AppData['books'],
  pages: [{ id: 'p1', bookId: 'b1', title: '第一篇', content: 'hello world', updatedAt: 1 }] as AppData['pages'],
  notes: {},
  annotations: [],
  ...over
})

describe('同步数据的读数', () => {
  it('报的是真算出来的：笔记多了，总大小跟着涨', () => {
    const 少 = measureSyncData(造({ annotations: [词(1), 词(2)] }))
    const 多 = measureSyncData(造({ annotations: Array.from({ length: 60 }, (_, i) => 词(i)) }))
    expect(多.totalBytes).toBeGreaterThan(少.totalBytes)
    expect(多.noteCount).toBe(60)
  })

  it('句摘比单词重 —— 它带着整句原文、句型和翻译', () => {
    const r = measureSyncData(造({
      annotations: [...Array.from({ length: 20 }, (_, i) => 词(i)), ...Array.from({ length: 20 }, (_, i) => 句(i))]
    }))
    const 单词 = r.notes.find((n) => n.kind === '单词')!
    const 句摘 = r.notes.find((n) => n.kind === '句摘')!
    expect(句摘.avgBytes).toBeGreaterThan(单词.avgBytes)
  })

  it('正文不算进 data.json —— 它单独存，平时不传', () => {
    const 短 = 造({ annotations: [词(1)] })
    const 长 = 造({
      annotations: [词(1)],
      pages: [{ ...短.pages[0], content: 'x'.repeat(500_000) }]
    })
    const a = measureSyncData(短)
    const b = measureSyncData(长)
    // 正文只在索引里留一枚指纹，所以 data.json 几乎不变（指纹里带长度，会差几个字节）
    expect(Math.abs(b.totalBytes - a.totalBytes)).toBeLessThan(100)
    // 但正文本身要如实报出来
    expect(b.contentChars).toBe(500_000)
  })

  it('各块按大小排好，笔记多的时候它该排在前面', () => {
    const r = measureSyncData(造({ annotations: Array.from({ length: 200 }, (_, i) => 词(i)) }))
    expect(r.parts[0].label).toBe('笔记')
    expect(r.parts.every((p, i, arr) => i === 0 || arr[i - 1].bytes >= p.bytes)).toBe(true)
  })

  /**
   * ⚠️ 旧 notes 和阅读进度**不进 data.json**（2026-09-04 先后摘出去的）。
   *
   * 它们不能混在 parts 里当成「占 0 字节的一块」—— 那会被读成
   * 「它在里面，只是不占地方」。单列一栏，说清楚是「压根没上云」。
   */
  it('旧 notes 不算进任何一块 —— 它已经不上云了', () => {
    const r = measureSyncData(造({ annotations: [词(1)], notes: { p1: { L0W0: { word: 'x' } } } }))
    expect(r.parts.some((p) => p.label.includes('旧模型'))).toBe(false)
    expect(r.excluded.some((e) => e.label.includes('旧模型'))).toBe(true)
  })

  it('没有旧 notes 时那一条就不列（多数人是这样）', () => {
    const r = measureSyncData(造({ annotations: [词(1)] }))
    expect(r.excluded.some((e) => e.label.includes('旧模型'))).toBe(false)
  })

  it('阅读进度永远单列一条 —— 它是这一版最值得说清楚的一件事', () => {
    const r = measureSyncData(造({ annotations: [词(1)] }))
    expect(r.excluded.some((e) => e.label === '阅读进度')).toBe(true)
  })

  it('进度不影响 data.json 的大小（拆出去之后的核心保证）', () => {
    const 没读过 = measureSyncData(造({ annotations: [词(1)] }))
    const 读了很久 = measureSyncData(
      造({
        annotations: [词(1)],
        pages: [{ ...造().pages[0], progress: 987654, progressAt: 1788500000000 }]
      })
    )
    expect(读了很久.totalBytes).toBe(没读过.totalBytes)
  })

  it('月用量和额度占比随大小走', () => {
    const 小 = estimateMonthlyUpload(30 * 1024)
    const 大 = estimateMonthlyUpload(300 * 1024)
    expect(大.bytes).toBe(小.bytes * 10)
    expect(大.percent).toBeGreaterThan(小.percent)
  })

  /**
   * ⚠️ 这里**不能**断言「笔记越多、余量越小」。
   *
   * 第一版就是那么写的，红了：合成数据里几百条笔记长得一模一样，
   * gzip 压得越来越狠，**平均每条反而更小**，于是余量算出来更大。
   * 那是合成数据的特性，不是代码错 —— 真实笔记各不相同，不会这么极端。
   *
   * 换成一条不依赖「数据有多重复」的性质：**别的东西占得多了，留给笔记的就少**。
   */
  it('「还能再划多少条」是正数；文档壳占得越多，余量越小', () => {
    const 笔记 = Array.from({ length: 50 }, (_, i) => 词(i))
    const 少量文档 = measureSyncData(造({ annotations: 笔记 }))
    const 大量文档 = measureSyncData(
      造({
        annotations: 笔记,
        pages: Array.from({ length: 400 }, (_, i) => ({
          id: `p${i}`,
          bookId: 'b1',
          title: `第 ${i} 章 · 一个够长的标题好占点地方`,
          content: 'hello world',
          updatedAt: 1
        })) as AppData['pages']
      })
    )
    const a = headroomNotes(少量文档)!
    const b = headroomNotes(大量文档)!
    expect(a).toBeGreaterThan(0)
    expect(b).toBeLessThan(a)
  })

  it('一条笔记都没有时不报「还能再划」—— 没有平均值可推', () => {
    expect(headroomNotes(measureSyncData(造()))).toBeNull()
  })
})
