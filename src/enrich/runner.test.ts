import { describe, it, expect, vi } from 'vitest'
import {
  chunk,
  runBatches,
  isWordNoteIncomplete,
  isSentenceIncomplete,
  mergeWordFill,
  mergeSentenceFill
} from './runner'
import { extractJson, collectResults } from './openaiCompatible'

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

describe('判断哪些笔记还没填全', () => {
  it('有一格空着就算待填充，不必整条空白', () => {
    expect(isWordNoteIncomplete({})).toBe(true)
    expect(isWordNoteIncomplete({ phonetic: '  ' })).toBe(true)
    // 从前这一条是「不算空白」，于是写了一半的卡片没人管
    expect(isWordNoteIncomplete({ definition: '站立' })).toBe(true)
    expect(isWordNoteIncomplete({ phonetic: '/stʊd/', pos: 'v.', definition: '站立' })).toBe(false)
  })

  it('lemma 不算格子：卡片上看不见它，不该左右判断', () => {
    expect(
      isWordNoteIncomplete({ phonetic: '/stʊd/', pos: 'v.', definition: '站立' })
    ).toBe(false)
  })

  it('句摘同理：写了句型没写翻译，仍要补', () => {
    expect(isSentenceIncomplete({ grammar: '', meaning: '' })).toBe(true)
    expect(isSentenceIncomplete({ grammar: '倒装句' })).toBe(true)
    expect(isSentenceIncomplete({ grammar: '倒装句', meaning: '译文' })).toBe(false)
  })
})

describe('只补空格，不动用户写过的', () => {
  const fill = { phonetic: '/stʊd/', pos: 'v.', definition: '站立', lemma: 'stand' }

  it('全空时四项都补上', () => {
    expect(mergeWordFill({}, fill)).toEqual(fill)
  })

  it('用户写过的那格原样保留，不出现在要写回的内容里', () => {
    expect(mergeWordFill({ definition: '我自己写的' }, fill)).toEqual({
      phonetic: '/stʊd/',
      pos: 'v.',
      lemma: 'stand'
    })
  })

  it('全都写过就没什么可补的，返回 null（上层据此跳过，不做无谓的写库）', () => {
    expect(mergeWordFill({ phonetic: 'a', pos: 'b', definition: 'c', lemma: 'd' }, fill)).toBeNull()
  })

  it('模型漏了某一项就补不上那一项，不会写进空字符串', () => {
    expect(mergeWordFill({}, { definition: '站立' })).toEqual({ definition: '站立' })
    expect(mergeWordFill({}, { definition: '   ' })).toBeNull()
  })

  it('顺手去掉模型返回的多余空白', () => {
    expect(mergeWordFill({}, { definition: '  站立  ' })).toEqual({ definition: '站立' })
  })

  it('句摘：只差翻译就只补翻译', () => {
    expect(
      mergeSentenceFill({ grammar: '我写的句型' }, { grammar: 'AI 的句型', meaning: '译文' })
    ).toEqual({ meaning: '译文' })
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
