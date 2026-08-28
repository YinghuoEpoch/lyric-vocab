import { describe, it, expect } from 'vitest'
import { buildAnchorMigrationMap, migratePage } from './migrateTokenizer'
import type { NotesMap, Sentence } from '../types'

/**
 * 切词规则变更的一次性数据迁移测试。
 *
 * 这是全项目唯一会「凭空改写用户已有数据」的地方，出错就是笔记错位或丢失，
 * 所以每种会导致词编号变化的情况都要有一条覆盖。
 */

const note = (word: string, extra: Partial<NotesMap[string]> = {}): NotesMap[string] => ({
  word,
  ...extra
})

const sentence = (over: Partial<Sentence> = {}): Sentence => ({
  id: 's1',
  text: '',
  grammar: '',
  meaning: '',
  docId: 'p1',
  startAnchorId: 'L0W0',
  endAnchorId: 'L0W1',
  date: 1,
  ...over
})

describe('anchor 对应表', () => {
  it('弯撇号：旧规则的 she / s 两个词合并成一个 she', () => {
    // 旧：L0W0=she L0W1=s L0W2=up   新：L0W0=she L0W1=up
    const map = buildAnchorMigrationMap('she’s up')
    expect(map.get('L0W0')?.anchorId).toBe('L0W0')
    expect(map.get('L0W0')?.word).toBe('she')
    expect(map.get('L0W2')?.anchorId).toBe('L0W1') // up 前移一位
    expect(map.get('L0W2')?.word).toBe('up')
  })

  it('直撇号：编号本来就没变，原样对应', () => {
    const map = buildAnchorMigrationMap("she's up")
    expect(map.get('L0W0')?.anchorId).toBe('L0W0')
    expect(map.get('L0W1')?.anchorId).toBe('L0W1')
  })

  it('COVID-19：词编号不变，但词的文字被刷新', () => {
    // 旧：L0W0=COVID-（19 掉在外面）  新：L0W0=COVID-19
    const map = buildAnchorMigrationMap('COVID-19 spread')
    expect(map.get('L0W0')).toEqual({ anchorId: 'L0W0', word: 'COVID-19' })
    expect(map.get('L0W1')?.word).toBe('spread')
  })

  it('1990s：旧规则只认得末尾的 s，新规则是完整的词', () => {
    const map = buildAnchorMigrationMap('the 1990s were')
    expect(map.get('L0W0')?.word).toBe('the')
    expect(map.get('L0W1')).toEqual({ anchorId: 'L0W1', word: '1990s' })
    expect(map.get('L0W2')?.word).toBe('were')
  })

  it('落单的连字符：旧规则当成一个词，新规则不算，后面的词整体前移', () => {
    // 旧：L0W0=a L0W1=- L0W2=b   新：L0W0=a L0W1=b
    const map = buildAnchorMigrationMap('a - b')
    expect(map.get('L0W0')?.anchorId).toBe('L0W0')
    expect(map.get('L0W2')?.anchorId).toBe('L0W1')
    expect(map.get('L0W2')?.word).toBe('b')
  })

  it('多行文本各行独立编号，互不影响', () => {
    const map = buildAnchorMigrationMap('she’s up\n中文\nCOVID-19 here')
    expect(map.get('L0W2')?.anchorId).toBe('L0W1')
    expect(map.get('L2W0')).toEqual({ anchorId: 'L2W0', word: 'COVID-19' })
  })
})

describe('迁移整篇文档', () => {
  it('笔记跟着搬到新编号，文字同步刷新', () => {
    const notes: NotesMap = {
      L0W0: note('she', { definition: '她' }),
      L0W2: note('up', { definition: '向上' })
    }
    const r = migratePage('she’s up', notes, [])

    expect(r.changed).toBe(true)
    expect(Object.keys(r.notes).sort()).toEqual(['L0W0', 'L0W1'])
    expect(r.notes.L0W0.word).toBe('she')
    expect(r.notes.L0W0.definition).toBe('她') // 释义没丢
    expect(r.notes.L0W1.word).toBe('up')
    expect(r.notes.L0W1.definition).toBe('向上')
  })

  it('词的文字变了也会刷新（COVID- -> COVID-19）', () => {
    const r = migratePage('COVID-19 spread', { L0W0: note('COVID-', { definition: '新冠' }) }, [])
    expect(r.notes.L0W0.word).toBe('COVID-19')
    expect(r.notes.L0W0.definition).toBe('新冠')
  })

  it('正文本来就没有歧义时不做无谓改动', () => {
    const notes: NotesMap = { L0W0: note('hello'), L0W1: note('world') }
    const r = migratePage('hello world', notes, [])
    expect(r.changed).toBe(false)
    expect(r.notes).toEqual(notes)
  })

  it('句摘的起止位置一并搬迁', () => {
    const s = sentence({ startAnchorId: 'L0W0', endAnchorId: 'L0W2' })
    const r = migratePage('she’s up', {}, [s])
    expect(r.sentences[0].startAnchorId).toBe('L0W0')
    expect(r.sentences[0].endAnchorId).toBe('L0W1')
    expect(r.sentences[0].orphaned).toBeUndefined()
  })

  it('已标记为孤儿的笔记与句摘原样保留，不参与迁移', () => {
    const notes: NotesMap = { 'orphan:x1': note('gone', { orphaned: true }) }
    const s = sentence({ orphaned: true, startAnchorId: 'L9W9', endAnchorId: 'L9W9' })
    const r = migratePage('she’s up', notes, [s])

    expect(r.notes['orphan:x1']).toEqual(notes['orphan:x1'])
    expect(r.sentences[0]).toEqual(s)
  })

  it('实在对不上位置的笔记标为孤儿，而不是悄悄丢掉', () => {
    // L5W0 在这段正文里根本不存在
    const r = migratePage('hello world', { L5W0: note('ghost', { definition: '幽灵' }) }, [])
    expect(r.notes.L5W0.orphaned).toBe(true)
    expect(r.notes.L5W0.definition).toBe('幽灵') // 内容保住了
    expect(r.changed).toBe(true)
  })

  it('两条笔记不会被搬到同一个位置上互相覆盖', () => {
    // 旧规则里 she 和 s 是两个词，新规则合并成一个 —— 只能有一条占住 L0W0
    const notes: NotesMap = { L0W0: note('she'), L0W1: note('s') }
    const r = migratePage('she’s up', notes, [])
    const targets = Object.keys(r.notes)
    expect(new Set(targets).size).toBe(targets.length) // 无重复键
    expect(Object.values(r.notes).some((n) => n.word === 'she')).toBe(true)
  })
})
