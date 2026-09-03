import { describe, it, expect } from 'vitest'
import {
  authHeader,
  buildTtsBody,
  defaultCloudConfig,
  isCloudReady,
  pickAudioBase64,
  CloudTtsError,
  readPayload
} from './cloudTts'
import { cloudCacheKey } from './cloudVoice'

const cfg = { ...defaultCloudConfig(), appid: 'a1', token: 't1' }

describe('isCloudReady', () => {
  it('三样齐了才算配好', () => {
    expect(isCloudReady(cfg)).toBe(true)
    expect(isCloudReady({ ...cfg, appid: '' })).toBe(false)
    expect(isCloudReady({ ...cfg, token: '' })).toBe(false)
    expect(isCloudReady({ ...cfg, voiceType: '' })).toBe(false)
  })

  it('只有空格不算填了 —— 粘贴时带进来的空白很常见', () => {
    expect(isCloudReady({ ...cfg, token: '   ' })).toBe(false)
  })
})

describe('authHeader', () => {
  it('⚠️ 是分号不是空格', () => {
    // 火山文档特意强调过。写成 `Bearer t1` 会被拒，而报错未必说得清原因
    expect(authHeader('t1')).toBe('Bearer;t1')
    expect(authHeader('t1')).not.toBe('Bearer t1')
  })
})

describe('buildTtsBody', () => {
  it('该带的都带上了', () => {
    const b = buildTtsBody(cfg, 'hello', 'r-1')
    expect(b.app).toEqual({ appid: 'a1', token: 't1', cluster: 'volcano_tts' })
    expect(b.audio.voice_type).toBe('BV001_streaming')
    expect(b.audio.encoding).toBe('mp3')
    expect(b.request).toMatchObject({ reqid: 'r-1', text: 'hello', operation: 'query' })
  })

  it('reqid 由外面给 —— 每次必须是新的，火山明写的', () => {
    expect(buildTtsBody(cfg, 'x', 'r-1').request.reqid).toBe('r-1')
    expect(buildTtsBody(cfg, 'x', 'r-2').request.reqid).toBe('r-2')
  })
})

describe('pickAudioBase64', () => {
  it('正常：code 3000 且有 data', () => {
    expect(pickAudioBase64({ code: 3000, data: 'QUJD' })).toBe('QUJD')
  })

  it('⚠️ 火山用 HTTP 200 回错误，所以只认包里的 code', () => {
    // 这个项目在别处栽过同一件事：光看状态码，把一张网页当录音存进了缓存
    expect(() => pickAudioBase64({ code: 3001, message: '额度不足' })).toThrow(CloudTtsError)
    expect(() => pickAudioBase64({ code: 3001, message: '额度不足' })).toThrow(/3001.*额度不足/)
  })

  it('报错里带上火山的原话，不然没法查', () => {
    expect(() => pickAudioBase64({ code: 3003, message: 'invalid voice_type' })).toThrow(
      /invalid voice_type/
    )
  })

  it('code 对但没有音频，也算失败', () => {
    expect(() => pickAudioBase64({ code: 3000, data: '' })).toThrow(CloudTtsError)
    expect(() => pickAudioBase64({ code: 3000 })).toThrow(CloudTtsError)
  })

  it('回包压根不是 JSON 对象（被劫持、登录页）', () => {
    expect(() => pickAudioBase64('<html>')).toThrow(/劫持/)
    expect(() => pickAudioBase64(null)).toThrow(/劫持/)
  })
})

describe('cloudCacheKey', () => {
  it('⚠️ 键里必须带音色，否则换了音色还放旧音色那一份', () => {
    expect(cloudCacheKey('hello', 'BV001_streaming')).not.toBe(
      cloudCacheKey('hello', 'BV002_streaming')
    )
  })

  it('和词典那边的键撞不上（那边第二格永远是数字 1 或 2）', () => {
    expect(cloudCacheKey('hello', 'BV001_streaming')).toBe('hello|cloud:BV001_streaming')
  })

  it('大小写和首尾空格不影响，同一句只花一次调用次数', () => {
    expect(cloudCacheKey('  Hello ', 'BV001_streaming')).toBe(cloudCacheKey('hello', 'BV001_streaming'))
  })
})

describe('readPayload：状态码不好看时先看正文', () => {
  it('⚠️ 401 但正文里有火山的原话，就报那句话', () => {
    // 实测：拿假令牌去问，火山回 HTTP 401，正文才是有用的那句
    const body = '{"reqid":"r1","code":3001,"message":"load grant: requested grant not found in SaaS storage"}'
    expect(() => readPayload(401, body)).toThrow(/load grant/)
    expect(() => readPayload(401, body)).toThrow(/3001/)
  })

  it('正文读不懂才退回状态码，而且把正文原样带一截出来', () => {
    expect(() => readPayload(502, '<html>Bad Gateway</html>')).toThrow(/502.*Bad Gateway/)
  })

  it('200 且正文正常：把音频取出来', () => {
    expect(readPayload(200, '{"code":3000,"data":"QUJD"}')).toBe('QUJD')
  })

  it('原生那边回的是已经解析好的对象，也认', () => {
    expect(readPayload(200, { code: 3000, data: 'QUJD' })).toBe('QUJD')
  })
})
