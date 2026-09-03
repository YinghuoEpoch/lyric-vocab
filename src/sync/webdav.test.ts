import { describe, it, expect } from 'vitest'
import { basicAuth, davMessage, davUrl, isSyncReady, defaultSyncConfig } from './webdav'

describe('davMessage：把 WebDAV 的报错变成人话', () => {
  it('⚠️ XML 开头全是命名空间，要抠出里面那句人话', () => {
    // 用户第一次试就撞上了这个：屏上显示的全是 <?xml ... xmlns:d="DAV:" ...，
    // 一个字的线索都没有 —— 真正有用的那句被截在了后面
    const xml =
      '<?xml version="1.0" encoding="UTF-8" standalone="no"?>' +
      '<d:error xmlns:d="DAV:" xmlns:s="http://ns.jianguoyun.com">' +
      '<s:exception>ConflictException</s:exception>' +
      '<s:message>父文件夹不存在</s:message></d:error>'
    expect(davMessage(xml)).toBe('父文件夹不存在')
  })

  it('只有 exception 没有 message 时，退而取 exception', () => {
    const xml = '<d:error xmlns:s="x"><s:exception>ConflictException</s:exception></d:error>'
    expect(davMessage(xml)).toBe('ConflictException')
  })

  it('压根不是 XML 就原样带出来（截断，别刷屏）', () => {
    expect(davMessage('plain failure')).toBe('plain failure')
    expect(davMessage('x'.repeat(500)).length).toBe(300)
  })

  it('多余的空白压平 —— XML 里的换行缩进会把一句话撑得很长', () => {
    expect(davMessage('<s:message>\n  出错\n  了\n</s:message>')).toBe('出错 了')
  })
})

describe('davUrl', () => {
  it('文件夹名带空格或中文也不会拼出坏地址', () => {
    expect(davUrl('我的 文库', 'data.json')).toContain(encodeURIComponent('我的 文库'))
    expect(davUrl('lyric-vocab', 'data.json')).toBe(
      'https://dav.jianguoyun.com/dav/lyric-vocab/data.json'
    )
  })

  it('开发时走 vite 转发那条', () => {
    expect(davUrl('lyric-vocab', 'data.json', true)).toBe('/jgy/dav/lyric-vocab/data.json')
  })

  it('首尾空格不带进地址 —— 粘贴时很容易多一个', () => {
    expect(davUrl('  lyric-vocab  ', 'data.json')).toBe(
      'https://dav.jianguoyun.com/dav/lyric-vocab/data.json'
    )
  })
})

describe('basicAuth', () => {
  it('就是标准的 Basic', () => {
    expect(basicAuth('a', 'b')).toBe(`Basic ${btoa('a:b')}`)
  })

  it('⚠️ 非 ASCII 也不能抛 —— btoa 只认 Latin-1，先转成 UTF-8 字节', () => {
    expect(() => basicAuth('用户@例子.com', 'pwd')).not.toThrow()
  })
})

describe('isSyncReady', () => {
  it('三样齐了才算，只有空格不算', () => {
    const c = { ...defaultSyncConfig(), username: 'a@b.c', password: 'p' }
    expect(isSyncReady(c)).toBe(true)
    expect(isSyncReady({ ...c, password: '  ' })).toBe(false)
    expect(isSyncReady({ ...c, folder: '' })).toBe(false)
  })
})
