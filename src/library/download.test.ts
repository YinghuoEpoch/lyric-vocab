import { describe, it, expect } from 'vitest'
import { asEpubFile, looksLikeEpub, parseTotal } from './download'

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

describe('asEpubFile', () => {
  const buf = bytes(0x50, 0x4b, 0x03, 0x04)

  it('用书名当文件名，导入器据此取默认书名', () => {
    expect(asEpubFile(buf, 'Pride and Prejudice').name).toBe('Pride and Prejudice.epub')
  })

  it('书名里的路径符号换成空格，免得节外生枝', () => {
    // 古登堡的书名里 : / ? 都很常见，例如「Moby Dick; Or, The Whale」这类还算温和的
    expect(asEpubFile(buf, 'A/B:C*D?E"F<G>H|I').name).toBe('A B C D E F G H I.epub')
  })

  it('书名全是符号时兜底，不生成一个只有扩展名的文件', () => {
    expect(asEpubFile(buf, '///').name).toBe('book.epub')
  })

  it('标成 epub 类型，导入器靠它认格式', () => {
    expect(asEpubFile(buf, 'x').type).toBe('application/epub+zip')
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
