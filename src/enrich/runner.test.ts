import { describe, it, expect, vi } from 'vitest'
import { chunk, runBatches, isWordNoteEmpty, isSentenceEmpty } from './runner'
import { extractJson, collectResults } from './deepseek'

/**
 * 「一键填充」的调度与解析测试。
 *
 * 这块的风险不在于算得对不对，而在于：中途断了会不会白跑、
 * 模型返回缺斤少两时会不会把好数据覆盖掉。
 */

describe('分批', () => {
  it('按批大小切开，最后一批可以不满', () => {
    expect(chunk([1, 2, 3, 4, 5], 2)).toEqual([[1, 2], [3, 4], [5]])
  })

  it('空列表得到空结果', () => {
    expect(chunk([], 10)).toEqual([])
  })
})

describe('执行与进度', () => {
  const tasks = Array.from({ length: 5 }, (_, i) => ({ id: `w${i}` }))

  it('逐批执行，进度累加到全部完成', async () => {
    const seen: number[] = []
    const result = await runBatches({
      tasks,
      batchSize: 2,
      run: async (batch) => Object.fromEntries(batch.map((t) => [t.id, { definition: 'x' }])),
      onBatch: () => {},
      onProgress: (p) => seen.push(p.done)
    })

    expect(result).toEqual({ done: 5, total: 5, filled: 5 })
    expect(seen).toEqual([0, 2, 4, 5]) // 起始 + 每批一次
  })

  it('每批完成就交给上层落库，不是等全部跑完（中断时已填的要留下）', async () => {
    const written: string[] = []
    await runBatches({
      tasks,
      batchSize: 2,
      run: async (batch) => Object.fromEntries(batch.map((t) => [t.id, { definition: 'x' }])),
      onBatch: (results) => {
        written.push(Object.keys(results).join(','))
      }
    })
    expect(written).toEqual(['w0,w1', 'w2,w3', 'w4'])
  })

  it('中断后不再发起新请求，已完成的批次保留', async () => {
    const controller = new AbortController()
    const written: string[] = []
    const run = vi.fn(async (batch: { id: string }[]) => {
      controller.abort() // 第一批跑完就取消
      return Object.fromEntries(batch.map((t) => [t.id, { definition: 'x' }]))
    })

    await expect(
      runBatches({
        tasks,
        batchSize: 2,
        run,
        onBatch: (r) => {
          written.push(Object.keys(r).join(','))
        },
        signal: controller.signal
      })
    ).rejects.toThrow(/取消/)

    expect(run).toHaveBeenCalledTimes(1) // 没有继续发第二批
    expect(written).toEqual(['w0,w1']) // 第一批的结果保住了
  })

  it('模型漏填的条目不计入 filled，但仍算处理过', async () => {
    const result = await runBatches({
      tasks,
      batchSize: 5,
      run: async () => ({ w0: { definition: 'x' }, w1: { definition: 'y' } }),
      onBatch: () => {}
    })
    expect(result).toEqual({ done: 5, total: 5, filled: 2 })
  })
})

describe('判断哪些是空白笔记', () => {
  it('三个字段都空才算空', () => {
    expect(isWordNoteEmpty({})).toBe(true)
    expect(isWordNoteEmpty({ phonetic: '  ' })).toBe(true)
    expect(isWordNoteEmpty({ definition: '站立' })).toBe(false)
    expect(isWordNoteEmpty({ pos: 'v.' })).toBe(false)
  })

  it('句摘同理', () => {
    expect(isSentenceEmpty({ grammar: '', meaning: '' })).toBe(true)
    expect(isSentenceEmpty({ meaning: '译文' })).toBe(false)
  })
})

describe('解析模型返回', () => {
  it('普通 JSON', () => {
    expect(extractJson('{"a":1}')).toEqual({ a: 1 })
  })

  it('被 ```json 围栏包着也能取出来', () => {
    expect(extractJson('```json\n{"a":1}\n```')).toEqual({ a: 1 })
    expect(extractJson('```\n{"a":2}\n```')).toEqual({ a: 2 })
  })

  it('不是 JSON 时抛错，由上层给出可读提示', () => {
    expect(() => extractJson('抱歉我无法完成')).toThrow()
  })

  it('按 id 归位，去掉空字段与首尾空白', () => {
    const parsed = {
      results: [
        { id: 'a', phonetic: ' /stʊd/ ', pos: 'v.', definition: '站立', lemma: 'stand' },
        { id: 'b', phonetic: '', definition: '  ' }, // 全是空的，丢弃
        { id: 'c', definition: '仅有释义' }
      ]
    }
    expect(collectResults(parsed, ['phonetic', 'pos', 'definition', 'lemma'])).toEqual({
      a: { phonetic: '/stʊd/', pos: 'v.', definition: '站立', lemma: 'stand' },
      c: { definition: '仅有释义' }
    })
  })

  it('结构不对时返回空，不会崩', () => {
    expect(collectResults({}, ['definition'])).toEqual({})
    expect(collectResults({ results: 'nope' }, ['definition'])).toEqual({})
    expect(collectResults({ results: [null, 42, { noId: 1 }] }, ['definition'])).toEqual({})
  })
})
