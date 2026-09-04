import { describe, it, expect, vi } from 'vitest'
import type { Annotation, AppData, Sentence } from './types'

/**
 * 存储层里跟「标注」有关的部分。
 *
 * localforage 换成内存里的一个 Map —— 测的是我们自己的逻辑，
 * 不是 IndexedDB 能不能用。每个用例都重新载入模块，
 * 因为 storage.ts 有一份模块级的 cache，不重置会互相串味。
 */
vi.mock('localforage', () => {
  const store = new Map<string, unknown>()
  return {
    default: {
      getItem: async (k: string) => (store.has(k) ? store.get(k) : null),
      setItem: async (k: string, v: unknown) => {
        store.set(k, v)
        return v
      }
    }
  }
})

const KEY = 'lyric-vocab-data'

const page = (id: string) => ({ id, bookId: null, title: id, content: '', updatedAt: 0 })

const anno = (over: Partial<Annotation> = {}): Annotation => ({
  id: 'a1',
  docId: 'p1',
  type: 'word',
  start: 'L0W0',
  end: 'L0W0',
  text: 'stood',
  createdAt: 1,
  ...over
})

/** 重新载入一份干净的存储层，并预置好数据 */
async function fresh(seed: Partial<AppData>) {
  vi.resetModules()
  const localforage = (await import('localforage')).default
  await localforage.setItem(KEY, {
    books: [],
    pages: [],
    notes: {},
    ...seed
  })
  return await import('./storage')
}

describe('selectAnnotations', () => {
  it('按正文顺序排，并能只要某一类', async () => {
    const s = await fresh({
      pages: [page('p1')],
      annotations: [
        // 故意存成乱的：次序是算出来的，跟它们在数组里的位置无关
        anno({ id: 'b', start: 'L1W0', end: 'L1W0', text: 'second' }),
        anno({ id: 'a', start: 'L0W0', end: 'L0W0', text: 'first' }),
        anno({ id: 's', start: 'L0W5', end: 'L0W9', type: 'sentence', text: '一个句子' }),
        anno({ id: 'other', docId: 'p2', text: '别篇的' })
      ]
    })
    const data = await s.getAppData()

    expect(s.selectAnnotations(data, 'p1').map((a) => a.id)).toEqual(['a', 's', 'b'])
    expect(s.selectAnnotations(data, 'p1', 'word').map((a) => a.id)).toEqual(['a', 'b'])
    expect(s.selectAnnotations(data, 'p1', 'sentence').map((a) => a.id)).toEqual(['s'])
  })

  it('order 字段是死的，存着什么都不影响排出来的次序', async () => {
    const s = await fresh({
      pages: [page('p1')],
      annotations: [
        anno({ id: 'a', start: 'L0W0', end: 'L0W0', order: 99 }),
        anno({ id: 'b', start: 'L1W0', end: 'L1W0', order: 0 })
      ]
    })
    const data = await s.getAppData()
    expect(s.selectAnnotations(data, 'p1').map((a) => a.id)).toEqual(['a', 'b'])
  })
})

describe('增删改', () => {
  it('saveAnnotation：没有就加，有就按 id 覆盖', async () => {
    const s = await fresh({ pages: [page('p1')], annotations: [] })

    let data = await s.saveAnnotation(anno({ id: 'a1' }))
    expect(data.annotations).toHaveLength(1)

    data = await s.saveAnnotation(anno({ id: 'a1', definition: '站立' }))
    expect(data.annotations).toHaveLength(1)
    expect(data.annotations![0].definition).toBe('站立')
  })

  it('deleteAnnotation 按 id 删；删不存在的 id 什么也不发生', async () => {
    const s = await fresh({ pages: [page('p1')], annotations: [anno({ id: 'a1' })] })

    let data = await s.deleteAnnotation('nope')
    expect(data.annotations).toHaveLength(1)

    data = await s.deleteAnnotation('a1')
    expect(data.annotations).toHaveLength(0)
  })

  it('replaceDocAnnotations 只动这一篇，别篇纹丝不动', async () => {
    const s = await fresh({
      pages: [page('p1'), page('p2')],
      annotations: [anno({ id: 'a', docId: 'p1' }), anno({ id: 'z', docId: 'p2' })]
    })

    const data = await s.replaceDocAnnotations('p1', [anno({ id: 'new', docId: 'p1' })])
    expect(data.annotations!.map((a) => a.id).sort()).toEqual(['new', 'z'])
  })
})

describe('updateVocabByText：改一个词，全库跟着改', () => {
  it('跨文档命中同一个词，且不区分大小写', async () => {
    const s = await fresh({
      pages: [page('p1'), page('p2')],
      annotations: [
        anno({ id: 'a', docId: 'p1', text: 'stood' }),
        anno({ id: 'b', docId: 'p2', text: 'Stood' }),
        anno({ id: 'c', docId: 'p1', text: 'walked' })
      ]
    })

    const data = await s.updateVocabByText('STOOD', { definition: '站立' })
    const byId = new Map(data.annotations!.map((a) => [a.id, a]))
    expect(byId.get('a')!.definition).toBe('站立')
    expect(byId.get('b')!.definition).toBe('站立')
    expect(byId.get('c')!.definition).toBeUndefined()
  })

  it('这是用户的手动编辑，所以顺手清掉「AI 填充」标记', async () => {
    const s = await fresh({
      pages: [page('p1')],
      annotations: [anno({ id: 'a', text: 'stood', auto: true, definition: 'AI 猜的' })]
    })

    const data = await s.updateVocabByText('stood', { definition: '我自己写的' })
    expect(data.annotations![0].auto).toBeUndefined()
    expect(data.annotations![0].definition).toBe('我自己写的')
  })

  it('短语也要改到 —— 复习页里它和单词是同一列卡片', async () => {
    const s = await fresh({
      pages: [page('p1')],
      annotations: [
        anno({
          id: 'p',
          type: 'phrase',
          text: 'take off',
          auto: true,
          definition: 'AI 猜的',
          grammar: 'AI 猜的用法'
        })
      ]
    })

    const data = await s.updateVocabByText('take off', {
      definition: '起飞',
      grammar: '常用于飞机'
    })
    expect(data.annotations![0].definition).toBe('起飞')
    expect(data.annotations![0].grammar).toBe('常用于飞机')
    // 从前这里写死 type !== 'word'，短语被静静跳过：改了不报错也存不进去
    expect(data.annotations![0].auto).toBeUndefined()
  })

  it('短语和单词按原文各认各的，不会互相串', async () => {
    const s = await fresh({
      pages: [page('p1')],
      annotations: [
        anno({ id: 'w', text: 'take' }),
        anno({ id: 'p', type: 'phrase', text: 'take off' })
      ]
    })
    const data = await s.updateVocabByText('take off', { definition: '起飞' })
    const byId = new Map(data.annotations!.map((a) => [a.id, a]))
    expect(byId.get('p')!.definition).toBe('起飞')
    expect(byId.get('w')!.definition).toBeUndefined()
  })

  it('句摘不参与 —— 它不是「词」', async () => {
    const s = await fresh({
      pages: [page('p1')],
      annotations: [anno({ id: 's', type: 'sentence', text: 'stood' })]
    })
    const data = await s.updateVocabByText('stood', { definition: '站立' })
    expect(data.annotations![0].definition).toBeUndefined()
  })
})

describe('一次性迁移', () => {
  const sentence: Sentence = {
    id: 's1',
    text: 'I have a dream',
    grammar: '',
    meaning: '梦想',
    docId: 'p1',
    startAnchorId: 'L0W0',
    endAnchorId: 'L0W3',
    date: 5
  }

  it('把旧的 notes + 句摘转成标注表，旧数据原样留着不删', async () => {
    const s = await fresh({
      pages: [page('p1')],
      notes: { p1: { L0W0: { word: 'stood', definition: '站立' } } }
    })

    const { data, report } = await s.runAnnotationMigration([sentence])

    expect(report).not.toBeNull()
    expect(report!.before).toBe(2)
    expect(report!.after).toBe(2)
    expect(data.annotations).toHaveLength(2)
    expect(data.annotationsMigratedAt).toBeTypeOf('number')

    // 保险：旧的一个字没动
    expect(data.notes.p1.L0W0.definition).toBe('站立')
  })

  it('只跑一次；第二次调用不会把迁移后新加的标注冲掉', async () => {
    const s = await fresh({
      pages: [page('p1')],
      notes: { p1: { L0W0: { word: 'stood' } } }
    })

    await s.runAnnotationMigration([])
    await s.saveAnnotation(anno({ id: 'brand-new', text: '迁移之后才加的' }))

    const { data, report } = await s.runAnnotationMigration([])
    expect(report).toBeNull() // 没再跑
    expect(data.annotations!.some((a) => a.id === 'brand-new')).toBe(true)
  })

  it('已经迁移过的库再启动，也不会重来一遍', async () => {
    const s = await fresh({
      pages: [page('p1')],
      notes: { p1: { L0W0: { word: 'stood' } } },
      annotations: [anno({ id: 'kept' })],
      annotationsMigratedAt: 123
    })

    const { data, report } = await s.runAnnotationMigration([sentence])
    expect(report).toBeNull()
    expect(data.annotations!.map((a) => a.id)).toEqual(['kept'])
  })
})

describe('和现有功能的衔接', () => {
  it('物理删除文档时，它的标注一并清掉，不留悬空数据', async () => {
    const s = await fresh({
      pages: [page('p1'), page('p2')],
      notes: { p1: { L0W0: { word: 'x' } } },
      annotations: [anno({ id: 'a', docId: 'p1' }), anno({ id: 'z', docId: 'p2' })]
    })

    const data = await s.deletePagePermanently('p1')
    expect(data.annotations!.map((a) => a.id)).toEqual(['z'])
  })

  it('恢复一份「迁移之前导出的」旧备份，会让迁移重新跑一遍', async () => {
    const s = await fresh({
      pages: [page('p1')],
      annotations: [anno({ id: 'a' })],
      annotationsMigratedAt: 123
    })

    // 旧备份里没有 annotations 字段
    const data = await s.replaceAllData({
      books: [],
      pages: [page('p1')],
      notes: { p1: { L0W0: { word: 'restored' } } }
    })

    expect(data.annotations).toEqual([])
    expect(data.annotationsMigratedAt).toBeUndefined()

    const { report } = await s.runAnnotationMigration([])
    expect(report!.after).toBe(1)
  })

  it('恢复一份新备份（里面已有标注）则照单全收，不重跑迁移', async () => {
    const s = await fresh({ pages: [], annotations: [] })

    const data = await s.replaceAllData({
      books: [],
      pages: [page('p1')],
      notes: {},
      annotations: [anno({ id: 'fromBackup' })],
      annotationsMigratedAt: 999
    })

    expect(data.annotations!.map((a) => a.id)).toEqual(['fromBackup'])
    expect(data.annotationsMigratedAt).toBe(999)
  })
})
