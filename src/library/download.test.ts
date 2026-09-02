import { describe, it, expect } from 'vitest'
import { asEpubFile, looksLikeEpub } from './download'

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
