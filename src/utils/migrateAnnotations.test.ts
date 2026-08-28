import { describe, it, expect } from 'vitest'
import { migrateToAnnotations, parseAnchor, describeReport } from './migrateAnnotations'
import type { LyricPage, NotesMap, Sentence } from '../types'

const page = (id: string): LyricPage => ({
  id,
  bookId: null,
  title: id,
  content: '',
  updatedAt: 0
})

/** 可预测的 id，方便断言 */
function counterIds() {
  let n = 0
  return () => `id${n++}`
}

function run(input: {
  pages?: LyricPage[]
  notes?: Record<string, NotesMap>
  sentences?: Sentence[]
}) {
  return migrateToAnnotations(
    {
      pages: input.pages ?? [],
      notes: input.notes ?? {},
      sentences: input.sentences ?? []
    },
    { makeId: counterIds(), now: 1000 }
  )
}

const sentence = (over: Partial<Sentence> = {}): Sentence => ({
  id: 's1',
  text: 'I have a dream',
  grammar: '主谓宾',
  meaning: '我有一个梦想',
  docId: 'p1',
  startAnchorId: 'L0W0',
  endAnchorId: 'L0W3',
  date: 500,
  ...over
})

describe('parseAnchor', () => {
  it('认得真坐标', () => {
    expect(parseAnchor('L0W2')).toEqual({ line: 0, word: 2 })
    expect(parseAnchor('L12W345')).toEqual({ line: 12, word: 345 })
  })

  it('孤儿键和其它杂物一律不认', () => {
    expect(parseAnchor('orphan:abc123')).toBeNull()
    expect(parseAnchor('')).toBeNull()
    expect(parseAnchor('L0')).toBeNull()
    expect(parseAnchor('L0W2x')).toBeNull()
  })
})

describe('migrateToAnnotations', () => {
  it('空数据进、空数据出', () => {
    const { annotations, report } = run({})
    expect(annotations).toEqual([])
    expect(report.before).toBe(0)
    expect(report.after).toBe(0)
  })

  it('单词笔记：坐标原样搬进 start/end，内容一个字段不丢', () => {
    const { annotations } = run({
      pages: [page('p1')],
      notes: {
        p1: {
          L0W2: {
            word: 'stood',
            phonetic: '/stʊd/',
            pos: 'v.',
            definition: '站立',
            lemma: 'stand',
            auto: true
          }
        }
      }
    })

    expect(annotations).toHaveLength(1)
    expect(annotations[0]).toEqual({
      id: 'id0',
      docId: 'p1',
      type: 'word',
      start: 'L0W2',
      end: 'L0W2',
      text: 'stood',
      order: 0,
      createdAt: 1000,
      phonetic: '/stʊd/',
      pos: 'v.',
      definition: '站立',
      lemma: 'stand',
      auto: true
    })
  })

  it('没填的可选字段不会留下一堆空键', () => {
    const { annotations } = run({
      pages: [page('p1')],
      notes: { p1: { L0W0: { word: 'hi' } } }
    })
    expect(Object.keys(annotations[0]).sort()).toEqual(
      ['createdAt', 'docId', 'end', 'id', 'order', 'start', 'text', 'type'].sort()
    )
  })

  it('按正文顺序排，而且是按数字比大小（L2W0 在 L10W0 前面）', () => {
    const { annotations } = run({
      pages: [page('p1')],
      notes: {
        p1: {
          L10W0: { word: 'ten' },
          L2W0: { word: 'two' },
          L2W10: { word: 'two-ten' },
          L2W2: { word: 'two-two' }
        }
      }
    })
    expect(annotations.map((a) => a.text)).toEqual(['two', 'two-two', 'two-ten', 'ten'])
    expect(annotations.map((a) => a.order)).toEqual([0, 1, 2, 3])
  })
})

describe('存量孤儿（原文已删除的旧笔记）', () => {
  it('orphan: 前缀的键被认出来，位置记成「没有」', () => {
    const { annotations, report } = run({
      pages: [page('p1')],
      notes: {
        p1: {
          'orphan:abc123': { word: 'gone', definition: '没了', orphaned: true }
        }
      }
    })

    expect(annotations).toHaveLength(1)
    expect(annotations[0].start).toBeNull()
    expect(annotations[0].end).toBeNull()
    // 内容照旧带过去，不是丢掉
    expect(annotations[0].text).toBe('gone')
    expect(annotations[0].definition).toBe('没了')
    expect(report.orphanWordNotes).toBe(1)
    expect(report.wordNotes).toBe(0)
  })

  it('老版本可能把孤儿留在真坐标上，只靠 orphaned 标记 —— 同样认得', () => {
    const { annotations } = run({
      pages: [page('p1')],
      notes: { p1: { L0W0: { word: 'gone', orphaned: true } } }
    })
    expect(annotations[0].start).toBeNull()
  })

  it('孤儿排在有位置的后面，且不占用它们的顺序', () => {
    const { annotations } = run({
      pages: [page('p1')],
      notes: {
        p1: {
          'orphan:zzz': { word: 'gone', orphaned: true },
          L1W0: { word: 'later' },
          L0W0: { word: 'first' }
        }
      }
    })
    expect(annotations.map((a) => a.text)).toEqual(['first', 'later', 'gone'])
    expect(annotations.map((a) => a.order)).toEqual([0, 1, 2])
  })
})

describe('句摘', () => {
  it('沿用原来的 id —— 迁移前后是同一条，不是新造一条', () => {
    const { annotations } = run({ pages: [page('p1')], sentences: [sentence()] })
    expect(annotations[0]).toEqual({
      id: 's1',
      docId: 'p1',
      type: 'sentence',
      start: 'L0W0',
      end: 'L0W3',
      text: 'I have a dream',
      order: 0,
      createdAt: 500,
      grammar: '主谓宾',
      meaning: '我有一个梦想'
    })
  })

  it('孤儿句摘同样记成「没有位置」', () => {
    const { annotations, report } = run({
      pages: [page('p1')],
      sentences: [sentence({ orphaned: true })]
    })
    expect(annotations[0].start).toBeNull()
    expect(annotations[0].text).toBe('I have a dream') // 原文留着，才能日后找回来
    expect(report.orphanSentences).toBe(1)
  })

  it('起止坐标本身是坏数据的，也当孤儿处理而不是留着一个假位置', () => {
    const { annotations } = run({
      pages: [page('p1')],
      sentences: [sentence({ startAnchorId: 'garbage', endAnchorId: 'L0W3' })]
    })
    expect(annotations[0].start).toBeNull()
  })

  it('同一文档内按创建时间排', () => {
    const { annotations } = run({
      pages: [page('p1')],
      sentences: [sentence({ id: 'late', date: 900 }), sentence({ id: 'early', date: 100 })]
    })
    expect(annotations.map((a) => a.id)).toEqual(['early', 'late'])
    expect(annotations.map((a) => a.order)).toEqual([0, 1])
  })

  it('重复 id 不会让两条句摘合成一条', () => {
    const { annotations } = run({
      pages: [page('p1')],
      sentences: [sentence({ id: 'dup', date: 1 }), sentence({ id: 'dup', date: 2 })]
    })
    expect(annotations).toHaveLength(2)
    expect(new Set(annotations.map((a) => a.id)).size).toBe(2)
  })

  it('不同文档各自从 0 开始编号', () => {
    const { annotations } = run({
      pages: [page('p1'), page('p2')],
      sentences: [sentence({ id: 'a', docId: 'p1' }), sentence({ id: 'b', docId: 'p2' })]
    })
    expect(annotations.map((a) => a.order)).toEqual([0, 0])
  })
})

describe('硬约束：一条都不能丢', () => {
  it('单词笔记 + 句摘 + 孤儿混在一起，进出条数相等', () => {
    const { annotations, report } = run({
      pages: [page('p1'), page('p2')],
      notes: {
        p1: {
          L0W0: { word: 'a' },
          L0W1: { word: 'b' },
          'orphan:x': { word: 'c', orphaned: true }
        },
        p2: { L5W3: { word: 'd' } }
      },
      sentences: [
        sentence({ id: 's1', docId: 'p1', date: 1 }),
        sentence({ id: 's2', docId: 'p2', date: 2, orphaned: true })
      ]
    })

    expect(report.before).toBe(6)
    expect(report.after).toBe(6)
    expect(annotations).toHaveLength(6)
    expect(new Set(annotations.map((a) => a.id)).size).toBe(6) // id 不重复
  })

  it('挂在已删除文档上的历史数据照搬保留，只是报个数', () => {
    const { annotations, report } = run({
      notes: { ghost: { L0W0: { word: 'x' } } },
      sentences: [sentence({ id: 's1', docId: 'ghost' })]
    })
    expect(annotations).toHaveLength(2)
    expect(report.danglingDocRefs).toBe(2)
    expect(report.before).toBe(report.after)
  })
})

describe('describeReport', () => {
  it('条数对得上时说「0 条丢失」', () => {
    const { report } = run({
      pages: [page('p1')],
      notes: { p1: { L0W0: { word: 'a' } } }
    })
    expect(describeReport(report)).toContain('0 条丢失')
    expect(describeReport(report)).not.toContain('⚠️')
  })
})
