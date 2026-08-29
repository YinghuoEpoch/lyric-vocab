import { describe, it, expect, vi } from 'vitest'
import { buildMarkLines, runMark, LINE_BATCH_SIZE } from './runner'
import type { LocatedMark } from './locate'
import type { MarkPick, Marker } from './types'

const content = [
  'He stood up and took off his hat', // L0
  '他站起来摘下帽子', // L1  中文对照行
  '', // L2  空行
  "She doesn't know the meaning of it" // L3
].join('\n')

const markerReturning = (picks: MarkPick[][]): Marker => {
  let i = 0
  return { name: 'fake', pick: vi.fn(async () => picks[i++] ?? []) }
}

describe('切行：只送含英文的行，行号用真实行号', () => {
  it('中文行和空行不送，但英文行的行号不重新编', () => {
    expect(buildMarkLines(content)).toEqual([
      { line: 0, text: 'He stood up and took off his hat' },
      { line: 3, text: "She doesn't know the meaning of it" }
    ])
  })

  it('空正文不炸', () => {
    expect(buildMarkLines('')).toEqual([])
  })
})

describe('跑一篇：定位与报数', () => {
  it('划上的交给上层落库，没对上的如实计数', async () => {
    const marker = markerReturning([
      [
        { line: 0, text: 'stood', kind: 'word' },
        { line: 0, text: 'take off', kind: 'phrase' }, // 给了原形，对不上
        { line: 3, text: 'meaning', kind: 'word' }
      ]
    ])
    const saved: LocatedMark[][] = []
    const p = await runMark({
      marker,
      content,
      options: { level: 'cet4', amount: 'few' },
      markedSpellings: new Set(),
      onBatch: (l) => {
        saved.push(l)
      }
    })
    expect(p.marked).toBe(2)
    expect(p.missed).toBe(1)
    expect(saved[0].map((m) => m.text)).toEqual(['stood', 'meaning'])
  })

  it('用户已经标过的词不再划', async () => {
    const marker = markerReturning([[{ line: 0, text: 'stood', kind: 'word' }]])
    const p = await runMark({
      marker,
      content,
      options: { level: 'cet4', amount: 'few' },
      markedSpellings: new Set(['stood']),
      onBatch: () => {}
    })
    expect(p.marked).toBe(0)
    expect(p.missed).toBe(1)
  })

  it('进度按行数走，跑完等于总行数', async () => {
    const marker = markerReturning([[]])
    const seen: number[] = []
    const p = await runMark({
      marker,
      content,
      options: { level: 'cet4', amount: 'few' },
      markedSpellings: new Set(),
      onBatch: () => {},
      onProgress: (x) => seen.push(x.done)
    })
    expect(p.total).toBe(2)
    expect(seen[seen.length - 1]).toBe(2)
  })

  it('一开始就被取消，一次请求都不发', async () => {
    const marker = markerReturning([[{ line: 0, text: 'stood', kind: 'word' }]])
    const ac = new AbortController()
    ac.abort()
    await expect(
      runMark({
        marker,
        content,
        options: { level: 'cet4', amount: 'few' },
        markedSpellings: new Set(),
        onBatch: () => {},
        signal: ac.signal
      })
    ).rejects.toThrow()
    expect(marker.pick).not.toHaveBeenCalled()
  })

  it('跨批不重复划：前一批划过的词，后一批再挑也不算', async () => {
    // 造一篇够长的正文，逼出两批
    const many = Array.from({ length: LINE_BATCH_SIZE + 5 }, () => 'He stood up there').join('\n')
    const marker = markerReturning([
      [{ line: 0, text: 'stood', kind: 'word' }],
      [{ line: LINE_BATCH_SIZE, text: 'stood', kind: 'word' }]
    ])
    const p = await runMark({
      marker,
      content: many,
      options: { level: 'cet4', amount: 'few' },
      markedSpellings: new Set(),
      onBatch: () => {}
    })
    expect(marker.pick).toHaveBeenCalledTimes(2)
    expect(p.marked).toBe(1)
    expect(p.missed).toBe(1)
  })
})
