import { describe, it, expect } from 'vitest'
import { pickEnglishVoice, estimateDurationMs } from './webSpeech'
import { describeSpeechFailure, describeWebSpeechError } from './errors'

/**
 * 朗读层的测试。
 *
 * 真发不发得出声得在手机上听，这里能测的是「挑哪个嗓子」和「兜底多久」——
 * 前者挑错了会拿中文嗓子念英文，后者算错了高亮会一直挂着像卡死。
 */

const voice = (lang: string, localService = false, name = lang) => ({ lang, localService, name })

describe('挑英文嗓子', () => {
  it('一个英文的都没有就返回空，交给系统自己看着办', () => {
    expect(pickEnglishVoice([voice('zh-CN'), voice('ja-JP')])).toBeUndefined()
  })

  it('本地合成优先 —— 离线可用、开口快', () => {
    const picked = pickEnglishVoice([voice('en-GB', false), voice('en-GB', true)])
    expect(picked?.localService).toBe(true)
  })

  it('同样是本地的，优先 en-US', () => {
    const picked = pickEnglishVoice([voice('en-GB', true, '英音'), voice('en-US', true, '美音')])
    expect(picked?.name).toBe('美音')
  })

  it('不拿中文嗓子凑数', () => {
    const picked = pickEnglishVoice([voice('zh-CN', true), voice('en-AU', false)])
    expect(picked?.lang).toBe('en-AU')
  })

  it('en_US 这种下划线写法也认', () => {
    expect(pickEnglishVoice([voice('en_US')])?.lang).toBe('en_US')
  })
})

describe('兜底时长', () => {
  it('越长的句子给越久', () => {
    expect(estimateDurationMs('stood')).toBeLessThan(estimateDurationMs('a much longer sentence'))
  })

  it('语速慢就给得更久', () => {
    expect(estimateDurationMs('stood', 0.5)).toBeGreaterThan(estimateDurationMs('stood', 1))
  })

  it('再长也有上限，不至于把高亮挂上几分钟', () => {
    expect(estimateDurationMs('x'.repeat(5000))).toBeLessThanOrEqual(20000)
  })
})

describe('错误说人话', () => {
  it('网页版：没有英文语音时标出来，界面好给「去安装」的入口', () => {
    const f = describeWebSpeechError('language-unavailable')
    expect(f.missingVoice).toBe(true)
    expect(f.message).toMatch(/英文语音/)
  })

  it('网页版：认不出的错误码也给一句能照着做的话', () => {
    expect(describeWebSpeechError(undefined).message).toMatch(/文字转语音/)
  })

  it('原生：报错文字里提到语音 / 语言，就当成缺语音包', () => {
    expect(describeSpeechFailure(new Error('Language is not supported')).missingVoice).toBe(true)
    expect(describeSpeechFailure(new Error('voice data missing')).missingVoice).toBe(true)
  })

  it('原生：别的错原样带出来，排查时有据可查', () => {
    const f = describeSpeechFailure(new Error('engine busy'))
    expect(f.missingVoice).toBe(false)
    expect(f.message).toMatch(/engine busy/)
  })

  it('原生：什么都没说时也不能甩一句空话', () => {
    expect(describeSpeechFailure(undefined).message).toMatch(/文字转语音/)
  })
})
