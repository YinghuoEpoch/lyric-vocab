import { describe, it, expect, vi, beforeEach } from 'vitest'
import { formatBytes } from './audioCache'
import { looksLikeMp3 } from './fetchAudio'

/**
 * 预取的测试。
 *
 * 真取不取得到得联网，这里测的是**别多取**：已经存过的不该再联网、
 * 同一页里重复的词只取一次、文库那种上千词的不能闷头全下、
 * 人已经翻走了就得停手。这几条错了不会报错，只会悄悄多花流量。
 */

const fetched: string[] = []
const stored: string[] = []
let cached = new Set<string>()

vi.mock('./audioCache', async (importOriginal) => {
  const real = await importOriginal<typeof import('./audioCache')>()
  return {
    ...real,
    cachedKeySet: async () => cached,
    putCached: async (key: string) => {
      stored.push(key)
    }
  }
})

vi.mock('./fetchAudio', async (importOriginal) => {
  const real = await importOriginal<typeof import('./fetchAudio')>()
  return {
    ...real,
    fetchAudioBytes: async (url: string) => {
      fetched.push(url)
      if (url.includes('zzqwmbl')) throw new Error('没有')
      return new ArrayBuffer(8)
    }
  }
})

const { prefetchWords, PREFETCH_LIMIT } = await import('./prefetch')

beforeEach(() => {
  fetched.length = 0
  stored.length = 0
  cached = new Set()
})

describe('预取', () => {
  it('存过的直接跳过，不再联网', async () => {
    cached = new Set(['stumble|2'])
    const stat = await prefetchWords(['stumble', 'serendipity'])
    expect(fetched.some((u) => u.includes('stumble'))).toBe(false)
    expect(stat.跳过).toBe(1)
    expect(stat.取了).toBe(1)
  })

  it('同一页里重复的词只取一次', async () => {
    await prefetchWords(['stood', 'stood', 'stood'])
    expect(fetched).toHaveLength(1)
  })

  it('整句不取 —— 词典里没有', async () => {
    await prefetchWords(['He stumbled over a stone in the dark.'])
    expect(fetched).toHaveLength(0)
  })

  it('短语要取', async () => {
    await prefetchWords(['give up'])
    expect(fetched).toHaveLength(1)
  })

  it('文库那种上千词的，取到上限就收手', async () => {
    const many = Array.from({ length: PREFETCH_LIMIT + 50 }, (_, i) => `word${i}`)
    await prefetchWords(many)
    expect(fetched).toHaveLength(PREFETCH_LIMIT)
  })

  it('人已经翻走了就停手', async () => {
    let n = 0
    await prefetchWords(['a1', 'a2', 'a3', 'a4'], { stopped: () => ++n > 2 })
    expect(fetched.length).toBeLessThan(4)
  })

  it('取不到不吭声，接着取下一个', async () => {
    const stat = await prefetchWords(['zzqwmbl', 'stumble'])
    expect(stat.失败).toBe(1)
    expect(stat.取了).toBe(1)
    expect(stored).toEqual(['stumble|2'])
  })
})

describe('占用写给人看', () => {
  it('小的按 B / KB，大的按 MB', () => {
    expect(formatBytes(512)).toBe('512B')
    expect(formatBytes(12717)).toBe('12KB')
    expect(formatBytes(6.1 * 1024 * 1024)).toBe('6.1MB')
  })
})

describe('只认真正的 mp3', () => {
  const mp3Id3 = () => new Uint8Array([0x49, 0x44, 0x33, 0x04, 0, 0]).buffer
  const mp3Sync = () => new Uint8Array([0xff, 0xfb, 0x90, 0x00]).buffer
  const html = () => new TextEncoder().encode('<!DOCTYPE html>\r\n<html lang="zh-CN">').buffer

  it('ID3 开头的认', () => {
    expect(looksLikeMp3(mp3Id3())).toBe(true)
  })

  it('帧同步开头的也认', () => {
    expect(looksLikeMp3(mp3Sync())).toBe(true)
  })

  it('网页不认 —— 转发没配好时它是 200，光看状态码会把它当录音存下来', () => {
    expect(looksLikeMp3(html())).toBe(false)
  })

  it('空的、太短的不认', () => {
    expect(looksLikeMp3(new ArrayBuffer(0))).toBe(false)
    expect(looksLikeMp3(new Uint8Array([0xff]).buffer)).toBe(false)
  })
})
