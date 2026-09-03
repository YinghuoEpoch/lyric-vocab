import { describe, it, expect } from 'vitest'
import { pack, unpack, formatSize } from './codec'

describe('装箱／拆箱', () => {
  it('装了再拆，一个字不差', () => {
    const json = JSON.stringify({ books: [], pages: [{ id: 'p1', content: 'hello world' }] })
    expect(unpack(pack(json))).toBe(json)
  })

  it('⚠️ 明文的老文件也要认 —— 用户云端已经有一份没压过的，读不出来就等于弄丢', () => {
    const json = '{"books":[],"pages":[]}'
    expect(unpack(json)).toBe(json)
    expect(unpack(`  ${json}  `)).toBe(json)
  })

  it('英文散文压得下来（这才是做这件事的理由）', () => {
    const prose = 'I never stood up very tall, and I think my voice was fairly small. '.repeat(500)
    const json = JSON.stringify({ pages: [{ content: prose }] })
    // 压完（含 base64 那三分之一的过路费）还是要小很多，不然白折腾
    expect(pack(json).length).toBeLessThan(json.length / 4)
  })

  it('中文也压得动', () => {
    const json = JSON.stringify({ pages: [{ content: '我从未挺起胸膛，伫立昂扬。'.repeat(500) }] })
    expect(pack(json).length).toBeLessThan(json.length / 4)
    expect(unpack(pack(json))).toBe(json)
  })

  it('很大的一份也不会爆栈（分块转 base64 就是为这个）', () => {
    const json = JSON.stringify({ pages: [{ content: 'x'.repeat(3_000_000) }] })
    expect(() => pack(json)).not.toThrow()
    expect(unpack(pack(json))).toBe(json)
  })

  it('体积写成人看的样子', () => {
    expect(formatSize(512)).toBe('512 B')
    expect(formatSize(2048)).toBe('2 KB')
    expect(formatSize(5 * 1024 * 1024)).toBe('5.0 MB')
  })
})
