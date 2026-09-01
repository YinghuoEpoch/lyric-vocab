import { describe, it, expect } from 'vitest'
import { createHumanFirstSpeaker } from './humanFirst'
import { dictAudioUrl, isSingleWord, AMERICAN, BRITISH } from './dictAudio'
import type { DictPlayer, Speaker } from './types'

/**
 * 「先真人，不行再机器」这一层的测试。
 *
 * 真人录音好不好听得在手机上听，这里能测的是**什么时候该退回系统朗读**——
 * 退早了白白用机器音，退晚了（或者该退不退）就是按了没声音。
 * 还有一条最容易写错的：用户按停之后，绝不能把刚停下的词再念一遍。
 */

/**
 * 假的系统朗读 + 假的录音播放器。
 *
 * 播放器要照着约定来：**被叫停时那次 play 算正常结束**（跟真货一样），
 * 否则测出来的是假货的脾气，不是代码的。
 */
function fakes() {
  const log: string[] = []
  const pending: Array<{ resolve: () => void; reject: (e: Error) => void }> = []

  const system: Speaker = {
    speak: (text) => {
      log.push(`念:${text}`)
      return Promise.resolve()
    },
    cancel: () => log.push('停念')
  }
  const player: DictPlayer = {
    play: (word) => {
      log.push(`放:${word}`)
      return new Promise<void>((resolve, reject) => {
        pending.push({ resolve, reject })
      })
    },
    cancel: () => {
      log.push('停放')
      while (pending.length) pending.pop()!.resolve()
    }
  }
  return {
    log,
    speaker: createHumanFirstSpeaker(system, player),
    /** 有这个词的录音，放完了 */
    finishPlay: () => pending.pop()?.resolve(),
    /** 词典里没有这个词 */
    failPlay: () => pending.pop()?.reject(new Error('没有')),
    /** 硬让还挂着的那次以出错收场 —— 试「按停之后又冒出个错」这种脏情况 */
    failOldest: () => pending.shift()?.reject(new Error('没有'))
  }
}

describe('先真人，不行再机器', () => {
  it('单个词先去取真人录音，不惊动系统朗读', async () => {
    const f = fakes()
    const done = f.speaker.speak('stumble')
    f.finishPlay()
    await done
    expect(f.log).toContain('放:stumble')
    expect(f.log.some((l) => l.startsWith('念:'))).toBe(false)
  })

  it('词典里没有就退回系统朗读，用户那边照样出声', async () => {
    const f = fakes()
    const done = f.speaker.speak('zzqwmbl')
    f.failPlay()
    await done
    expect(f.log).toContain('念:zzqwmbl')
  })

  it('整句不查词典，直接念 —— 查了也是白跑一趟', async () => {
    const f = fakes()
    await f.speaker.speak('He stumbled over a stone.')
    expect(f.log.some((l) => l.startsWith('放:'))).toBe(false)
    expect(f.log).toContain('念:He stumbled over a stone.')
  })

  it('语速照旧传给系统朗读', async () => {
    const log: string[] = []
    const system: Speaker = {
      speak: (t, o) => {
        log.push(`${t}@${o?.rate}`)
        return Promise.resolve()
      },
      cancel: () => {}
    }
    const player: DictPlayer = { play: () => Promise.reject(new Error('没有')), cancel: () => {} }
    await createHumanFirstSpeaker(system, player).speak('zzqwmbl', { rate: 0.85 })
    expect(log).toEqual(['zzqwmbl@0.85'])
  })

  it('按停之后不许把刚停下的词再念一遍', async () => {
    const f = fakes()
    const done = f.speaker.speak('stumble')
    f.speaker.cancel()
    // 叫停时放录音那边算正常结束，所以这里已经没得可拒。
    // 但万一将来它改成「被叫停就报错」，也绝不能因此补念一遍 —— 号已经走过一格了
    f.failPlay()
    await done
    expect(f.log.some((l) => l.startsWith('念:'))).toBe(false)
  })

  it('取录音的空当里点了别的词，前一个不许插进来念', async () => {
    const f = fakes()
    const first = f.speaker.speak('stumble')
    const second = f.speaker.speak('serendipity')
    // 点第二个词时第一次播放已被叫停（正常结束），第二个还挂着。
    // 让第二个报错：该落回系统朗读的是第二个词，第一个不许冒出来
    f.failPlay()
    await Promise.all([first, second])
    expect(f.log).toContain('念:serendipity')
    expect(f.log.some((l) => l === '念:stumble')).toBe(false)
  })

  it('换一个词时，上一次的录音和上一句都要停掉', async () => {
    const f = fakes()
    void f.speaker.speak('stumble')
    void f.speaker.speak('serendipity')
    expect(f.log.filter((l) => l === '停放').length).toBeGreaterThanOrEqual(2)
    expect(f.log).toContain('停念')
  })
})

describe('查不查词典', () => {
  it('单个词才查', () => {
    expect(isSingleWord('stumble')).toBe(true)
    expect(isSingleWord('  stumble  ')).toBe(true)
  })

  it('带空格的一律不查 —— 词典里没有整句', () => {
    expect(isSingleWord('give up')).toBe(false)
    expect(isSingleWord('He stumbled.')).toBe(false)
  })

  it('空的不查', () => {
    expect(isSingleWord('')).toBe(false)
    expect(isSingleWord('   ')).toBe(false)
  })
})

describe('发音地址', () => {
  it('默认美音', () => {
    expect(dictAudioUrl('stumble')).toContain(`type=${AMERICAN}`)
  })

  it('要英音也给得出来', () => {
    expect(dictAudioUrl('stumble', BRITISH)).toContain(`type=${BRITISH}`)
  })

  it('带连字符、数字的词不能被地址吃掉', () => {
    expect(dictAudioUrl('COVID-19')).toContain('audio=COVID-19')
    expect(dictAudioUrl('1990s')).toContain('audio=1990s')
  })

  it('前后空格不带进地址里', () => {
    expect(dictAudioUrl('  stumble ')).toContain('audio=stumble&')
  })
})
