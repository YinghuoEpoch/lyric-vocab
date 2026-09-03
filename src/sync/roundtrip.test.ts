import { describe, it, expect } from 'vitest'
import { mergeAppData } from './merge'
import {
  contentsOf,
  fromIndex,
  pagesToDownload,
  pagesToUpload,
  toIndex,
  type SyncIndex
} from './split'
import type { AppData } from '../types'

/**
 * 两台设备来回同步的整段推演。
 *
 * ⚠️ 拆开存正文之后，**同步不再是一次读写，而是「索引 + 若干篇正文」的一组读写**，
 * 中间任何一步判错都可能把正文弄丢，而且丢了不报错。
 * 所以这里不测某个函数，而是**把两台设备的整个来回跑一遍**，
 * 每一轮都断言「两台看到的东西一样，而且正文一个字没少」。
 *
 * 这里用一个假的云端（就是几个 Map），语义照着真的来：
 * 索引一个文件、每篇正文一个文件。
 */
class FakeCloud {
  index: SyncIndex | null = null
  pages = new Map<string, string>()
  /** 记账：这一趟传了几篇正文。省流量的效果就靠它证明 */
  uploads: string[] = []
  downloads: string[] = []
}

/** 一台设备同步一次：完全照着 syncNow 的步骤走 */
function syncDevice(cloud: FakeCloud, local: AppData, base: AppData | null): AppData {
  const localIndex = toIndex(local)
  const baseIndex = base ? toIndex(base) : null

  if (cloud.index === null) {
    cloud.index = localIndex
    for (const [id, c] of contentsOf(local)) {
      cloud.pages.set(id, c)
      cloud.uploads.push(id)
    }
    return local
  }

  const { merged: mergedIndex } = mergeAppData(
    baseIndex as unknown as AppData | null,
    localIndex as unknown as AppData,
    cloud.index as unknown as AppData
  ) as unknown as { merged: SyncIndex }

  const contents = contentsOf(local)
  for (const id of pagesToDownload(mergedIndex, contents)) {
    const got = cloud.pages.get(id)
    cloud.downloads.push(id)
    if (got !== undefined) contents.set(id, got)
  }

  // 先传正文再写索引 —— 顺序和真货一致
  for (const id of pagesToUpload(mergedIndex, cloud.index)) {
    cloud.pages.set(id, contents.get(id) ?? '')
    cloud.uploads.push(id)
  }
  cloud.index = mergedIndex

  return fromIndex(mergedIndex, contents)
}

function page(id: string, content: string, updatedAt = 1) {
  return { id, bookId: 'b1', title: id, content, updatedAt }
}
function ann(id: string, def: string) {
  return {
    id,
    docId: 'p1',
    type: 'word' as const,
    start: 'L0W0',
    end: 'L0W0',
    text: 'w',
    order: 0,
    createdAt: 1,
    definition: def
  }
}
function data(over: Partial<AppData> = {}): AppData {
  return { books: [], pages: [], notes: {}, annotations: [], ...over }
}

const BOOK = 'I never stood up very tall. '.repeat(200)

describe('两台设备来回同步（拆开存正文之后）', () => {
  it('⚠️ 划词只传索引，一篇正文都不传 —— 这就是拆开的全部意义', () => {
    const cloud = new FakeCloud()
    // 手机先把书传上去
    let phone = data({ pages: [page('p1', BOOK), page('p2', BOOK)] })
    let phoneBase = syncDevice(cloud, phone, null)
    cloud.uploads = []

    // 手机上划了个词
    phone = { ...phoneBase, annotations: [ann('a1', '绊倒')] }
    phoneBase = syncDevice(cloud, phone, phoneBase)

    expect(cloud.uploads).toEqual([]) // 正文一篇都没传
    expect(cloud.index?.annotations).toHaveLength(1)
  })

  it('平板第一次同步：正文该下的下、笔记该有的有', () => {
    const cloud = new FakeCloud()
    const phone = data({ pages: [page('p1', BOOK)], annotations: [ann('a1', '绊倒')] })
    syncDevice(cloud, phone, null)

    const tablet = syncDevice(cloud, data(), null)
    expect(tablet.pages[0].content).toBe(BOOK)
    expect(tablet.annotations).toHaveLength(1)
  })

  it('⚠️ 两台各划各的词：都保留，而且正文一个字没少', () => {
    const cloud = new FakeCloud()
    const start = data({ pages: [page('p1', BOOK)] })
    const phoneBase = syncDevice(cloud, start, null)
    const tabletBase = syncDevice(cloud, data(), null)

    const phone = syncDevice(
      cloud,
      { ...phoneBase, annotations: [ann('a1', '手机划的')] },
      phoneBase
    )
    const tablet = syncDevice(
      cloud,
      { ...tabletBase, annotations: [ann('a2', '平板划的')] },
      tabletBase
    )
    // 手机再同步一次，把平板那条也吸收进来
    const phone2 = syncDevice(cloud, phone, phone)

    expect(tablet.annotations?.map((a) => a.id).sort()).toEqual(['a1', 'a2'])
    expect(phone2.annotations?.map((a) => a.id).sort()).toEqual(['a1', 'a2'])
    expect(phone2.pages[0].content).toBe(BOOK)
    expect(tablet.pages[0].content).toBe(BOOK)
  })

  it('改了正文：那一篇（也只有那一篇）会传，另一台拿得到新的', () => {
    const cloud = new FakeCloud()
    const start = data({ pages: [page('p1', BOOK), page('p2', BOOK)] })
    const phoneBase = syncDevice(cloud, start, null)
    const tabletBase = syncDevice(cloud, data(), null)
    cloud.uploads = []

    const edited = {
      ...phoneBase,
      pages: [{ ...phoneBase.pages[0], content: BOOK + ' 改过了', updatedAt: 2 }, phoneBase.pages[1]]
    }
    syncDevice(cloud, edited, phoneBase)
    expect(cloud.uploads).toEqual(['p1']) // 只有改过的那一篇

    const tablet = syncDevice(cloud, tabletBase, tabletBase)
    expect(tablet.pages.find((p) => p.id === 'p1')?.content).toBe(BOOK + ' 改过了')
    expect(tablet.pages.find((p) => p.id === 'p2')?.content).toBe(BOOK)
  })

  it('⚠️ 反复同步不会把正文磨没 —— 空内容是这类拆分最容易出的事故', () => {
    const cloud = new FakeCloud()
    let d = data({ pages: [page('p1', BOOK), page('p2', BOOK)], annotations: [ann('a1', 'x')] })
    let base: AppData | null = null
    for (let i = 0; i < 6; i++) {
      d = syncDevice(cloud, d, base)
      base = d
    }
    expect(d.pages.every((p) => p.content === BOOK)).toBe(true)
    expect(d.pages).toHaveLength(2)
  })

  it('一台删了一篇：另一台跟着删，剩下那篇的正文不受影响', () => {
    const cloud = new FakeCloud()
    const start = data({ pages: [page('p1', BOOK), page('p2', BOOK)] })
    const phoneBase = syncDevice(cloud, start, null)
    const tabletBase = syncDevice(cloud, data(), null)

    const afterDelete = syncDevice(
      cloud,
      { ...phoneBase, pages: phoneBase.pages.filter((p) => p.id !== 'p2') },
      phoneBase
    )
    expect(afterDelete.pages.map((p) => p.id)).toEqual(['p1'])

    const tablet = syncDevice(cloud, tabletBase, tabletBase)
    expect(tablet.pages.map((p) => p.id)).toEqual(['p1'])
    expect(tablet.pages[0].content).toBe(BOOK)
  })

  it('平板离线改了笔记、手机同时改了正文：两件事都留下来', () => {
    const cloud = new FakeCloud()
    const start = data({ pages: [page('p1', BOOK)] })
    const phoneBase = syncDevice(cloud, start, null)
    const tabletBase = syncDevice(cloud, data(), null)

    // 手机改正文
    syncDevice(
      cloud,
      { ...phoneBase, pages: [{ ...phoneBase.pages[0], content: BOOK + '（手机改的）', updatedAt: 9 }] },
      phoneBase
    )
    // 平板（离线期间加了笔记）现在才同步
    const tablet = syncDevice(
      cloud,
      { ...tabletBase, annotations: [ann('a9', '平板离线写的')] },
      tabletBase
    )

    expect(tablet.pages[0].content).toBe(BOOK + '（手机改的）')
    expect(tablet.annotations?.map((a) => a.id)).toEqual(['a9'])
  })

  it('⚠️ 在一台上拖动排序，同步之后两台都是新次序（拆开存之后照样要成立）', () => {
    const cloud = new FakeCloud()
    const start = data({ pages: [page('p1', BOOK), page('p2', BOOK), page('p3', BOOK)] })
    const phoneBase = syncDevice(cloud, start, null)
    const tabletBase = syncDevice(cloud, data(), null)

    // 手机上把 p3 拖到最前面
    const reordered = {
      ...phoneBase,
      pages: [phoneBase.pages[2], phoneBase.pages[0], phoneBase.pages[1]]
    }
    const phone = syncDevice(cloud, reordered, phoneBase)
    expect(phone.pages.map((p) => p.id)).toEqual(['p3', 'p1', 'p2'])

    const tablet = syncDevice(cloud, tabletBase, tabletBase)
    expect(tablet.pages.map((p) => p.id)).toEqual(['p3', 'p1', 'p2'])
    // 拖动不该引起任何正文重传
    expect(tablet.pages.every((p) => p.content === BOOK)).toBe(true)
  })

  it('拖动排序不传正文 —— 正文一个字没变，凭什么传', () => {
    const cloud = new FakeCloud()
    const start = data({ pages: [page('p1', BOOK), page('p2', BOOK)] })
    const base = syncDevice(cloud, start, null)
    cloud.uploads = []

    syncDevice(cloud, { ...base, pages: [base.pages[1], base.pages[0]] }, base)
    expect(cloud.uploads).toEqual([])
  })

  it('复习页重排卡片：另一台跟着变，而且一篇正文都不传', () => {
    const cloud = new FakeCloud()
    const start = data({
      pages: [page('p1', BOOK)],
      annotations: [
        { ...ann('a1', '一'), order: 0 },
        { ...ann('a2', '二'), order: 1 }
      ]
    })
    const phoneBase = syncDevice(cloud, start, null)
    const tabletBase = syncDevice(cloud, data(), null)
    cloud.uploads = []

    // 手机上把两张卡对调
    const reordered = {
      ...phoneBase,
      annotations: phoneBase.annotations!.map((a) => ({ ...a, order: a.order === 0 ? 1 : 0 }))
    }
    syncDevice(cloud, reordered, phoneBase)
    expect(cloud.uploads).toEqual([]) // 正文一篇没传

    const tablet = syncDevice(cloud, tabletBase, tabletBase)
    const byId = new Map(tablet.annotations!.map((a) => [a.id, a.order]))
    expect([byId.get('a1'), byId.get('a2')]).toEqual([1, 0])
    expect(tablet.pages[0].content).toBe(BOOK)
  })
})
