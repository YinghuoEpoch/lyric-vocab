import { describe, it, expect } from 'vitest'
import { asBookFile, looksLikeEpub, looksLikeText, parseTotal } from './download'
import type { CatalogBook } from './catalog'

function bytes(...vals: number[]): ArrayBuffer {
  return new Uint8Array(vals).buffer
}

/**
 * 这一组防的是取发音时栽过的那个跟头：状态码 200，内容却是一段 HTML
 * （开发转发配错、公共 WiFi 登录页、运营商插页），结果把网页当成文件收了下来。
 */
describe('looksLikeEpub', () => {
  it('认 zip 文件头 —— epub 本质就是个 zip', () => {
    expect(looksLikeEpub(bytes(0x50, 0x4b, 0x03, 0x04, 0x14, 0x00))).toBe(true)
  })

  it('一段 HTML 不认（"<!DO"）', () => {
    expect(looksLikeEpub(bytes(0x3c, 0x21, 0x44, 0x4f))).toBe(false)
  })

  it('太短的不认', () => {
    expect(looksLikeEpub(bytes(0x50, 0x4b))).toBe(false)
    expect(looksLikeEpub(bytes())).toBe(false)
  })

  it('只对了一半也不认', () => {
    expect(looksLikeEpub(bytes(0x50, 0x4b, 0x05, 0x06))).toBe(false)
  })
})

/**
 * 澳洲站给的是纯文本，没有文件头可认。要防的东西还是一样：
 * 别把运营商插页、WiFi 登录页那种 200 的 HTML 当成书收下来。
 */
describe('looksLikeText', () => {
  const of = (str: string) => new TextEncoder().encode(str).buffer

  it('正常的书开头认得出来', () => {
    expect(looksLikeText(of('\n\nProject Gutenberg Australia\n\nTitle: Animal Farm\n'))).toBe(true)
  })

  it('一段 HTML 不认', () => {
    expect(looksLikeText(of('<!DOCTYPE html>\n<html><head><title>404</title>'))).toBe(false)
    expect(looksLikeText(of('  <html lang="en">此处省略一大段网页'))).toBe(false)
    expect(looksLikeText(of('<?xml version="1.0"?><rss>这是个订阅源不是书'))).toBe(false)
  })

  it('二进制（含 0 字节）不认 —— 那多半是拿错了格式', () => {
    const b = new Uint8Array(40)
    b.set(new TextEncoder().encode('Title: something'), 0)
    expect(looksLikeText(b.buffer)).toBe(false)
  })

  it('太短的不认', () => {
    expect(looksLikeText(of('hi'))).toBe(false)
  })
})

describe('asBookFile', () => {
  const buf = bytes(0x50, 0x4b, 0x03, 0x04)
  const us = (title: string): CatalogBook => ({ source: 'g', ref: '1342', title, author: '' })
  const aus = (title: string): CatalogBook => ({
    source: 'a',
    ref: 'ebooks01/0100021.txt',
    title,
    author: ''
  })

  it('美国站包成 epub，导入器据此走 zip 那条路', () => {
    const f = asBookFile(buf, us('Pride and Prejudice'))
    expect(f.name).toBe('Pride and Prejudice.epub')
    expect(f.type).toBe('application/epub+zip')
  })

  it('澳洲站包成 txt —— 拿到的本来就是纯文本，包错了解析会当场炸', () => {
    const f = asBookFile(buf, aus('Nineteen eighty-four'))
    expect(f.name).toBe('Nineteen eighty-four.txt')
    expect(f.type).toBe('text/plain')
  })

  it('书名里的路径符号换成空格，免得节外生枝', () => {
    // 古登堡的书名里 : / ? 都很常见，例如「Moby Dick; Or, The Whale」这类还算温和的
    expect(asBookFile(buf, us('A/B:C*D?E"F<G>H|I')).name).toBe('A B C D E F G H I.epub')
  })

  it('书名全是符号时兜底，不生成一个只有扩展名的文件', () => {
    expect(asBookFile(buf, us('///')).name).toBe('book.epub')
  })
})

/**
 * 分段下载靠这个总长判断「下完没有」。解析错了要么截断、要么一直要下去，
 * 所以把各种写法都钉住。
 */
describe('parseTotal', () => {
  it('从 Content-Range 里取出总长', () => {
    expect(parseTotal({ 'content-range': 'bytes 0-255/1234' })).toBe(1234)
  })

  it('头的大小写不认死', () => {
    expect(parseTotal({ 'Content-Range': 'bytes 0-255/999' })).toBe(999)
    expect(parseTotal({ 'CONTENT-RANGE': 'bytes 0-255/999' })).toBe(999)
  })

  it('末尾有空白也认', () => {
    expect(parseTotal({ 'content-range': 'bytes 0-255/500  ' })).toBe(500)
  })

  it('总长未知（星号）时返回 null，不能当成 0', () => {
    // 当成 0 的话会立刻判定「已下完」，交出一个空文件
    expect(parseTotal({ 'content-range': 'bytes 0-255/*' })).toBeNull()
  })

  it('没有这个头、或整个 headers 缺失时返回 null', () => {
    expect(parseTotal({ 'content-type': 'application/epub+zip' })).toBeNull()
    expect(parseTotal(undefined)).toBeNull()
    expect(parseTotal({})).toBeNull()
  })
})
