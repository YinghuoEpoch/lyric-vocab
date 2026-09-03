import { describe, it, expect } from 'vitest'
import { createHumanFirstSpeaker } from './humanFirst'
import { dictAudioUrl, isLookupWorthy, AMERICAN, BRITISH } from './dictAudio'
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
    const done = f.speaker.speak('stumble', { lookup: true })
    f.finishPlay()
    await done
    expect(f.log).toContain('放:stumble')
    expect(f.log.some((l) => l.startsWith('念:'))).toBe(false)
  })

  it('词典里没有就退回系统朗读，用户那边照样出声', async () => {
    const f = fakes()
    const done = f.speaker.speak('zzqwmbl', { lookup: true })
    f.failPlay()
    await done
    expect(f.log).toContain('念:zzqwmbl')
  })

  it('句摘卡说了不查，就直接念 —— 词典里没有整句', async () => {
    const f = fakes()
    await f.speaker.speak('He stumbled over a stone.', { lookup: false })
    expect(f.log.some((l) => l.startsWith('放:'))).toBe(false)
    // 念出去的不是原文：冠词 a 先被改写过，否则这台手机的引擎会念成字母名
    expect(f.log).toContain('念:He stumbled over uh stone.')
  })

  it('退回机器音的那条路，也得先过一遍读音补丁', async () => {
    const f = fakes()
    const done = f.speaker.speak('with a thud', { lookup: true })
    f.failPlay()
    await done
    expect(f.log).toContain('念:with uh thud')
  })

  it('走真人录音时一个字都不许改 —— 补丁只对机器音', async () => {
    const f = fakes()
    const done = f.speaker.speak('with a thud', { lookup: true })
    f.finishPlay()
    await done
    expect(f.log).toContain('放:with a thud')
  })

  it('短语也去查词典 —— 词典里 give up 这类是有录音的', async () => {
    const f = fakes()
    const done = f.speaker.speak('give up', { lookup: true })
    f.finishPlay()
    await done
    expect(f.log).toContain('放:give up')
    expect(f.log.some((l) => l.startsWith('念:'))).toBe(false)
  })

  it('调用处没说要查，就一个字也不查', async () => {
    const f = fakes()
    await f.speaker.speak('stumble')
    expect(f.log.some((l) => l.startsWith('放:'))).toBe(false)
    expect(f.log).toContain('念:stumble')
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
    await createHumanFirstSpeaker(system, player).speak('zzqwmbl', { rate: 0.85, lookup: true })
    expect(log).toEqual(['zzqwmbl@0.85'])
  })

  it('按停之后不许把刚停下的词再念一遍', async () => {
    const f = fakes()
    const done = f.speaker.speak('stumble', { lookup: true })
    f.speaker.cancel()
    // 叫停时放录音那边算正常结束，所以这里已经没得可拒。
    // 但万一将来它改成「被叫停就报错」，也绝不能因此补念一遍 —— 号已经走过一格了
    f.failPlay()
    await done
    expect(f.log.some((l) => l.startsWith('念:'))).toBe(false)
  })

  it('取录音的空当里点了别的词，前一个不许插进来念', async () => {
    const f = fakes()
    const first = f.speaker.speak('stumble', { lookup: true })
    const second = f.speaker.speak('serendipity', { lookup: true })
    // 点第二个词时第一次播放已被叫停（正常结束），第二个还挂着。
    // 让第二个报错：该落回系统朗读的是第二个词，第一个不许冒出来
    f.failPlay()
    await Promise.all([first, second])
    expect(f.log).toContain('念:serendipity')
    expect(f.log.some((l) => l === '念:stumble')).toBe(false)
  })

  it('换一个词时，上一次的录音和上一句都要停掉', async () => {
    const f = fakes()
    void f.speaker.speak('stumble', { lookup: true })
    void f.speaker.speak('serendipity', { lookup: true })
    expect(f.log.filter((l) => l === '停放').length).toBeGreaterThanOrEqual(2)
    expect(f.log).toContain('停念')
  })
})

describe('值不值得查词典', () => {
  it('单词查', () => {
    expect(isLookupWorthy('stumble')).toBe(true)
    expect(isLookupWorthy('  stumble  ')).toBe(true)
  })

  it('短语也查 —— 词典里收固定搭配', () => {
    expect(isLookupWorthy('give up')).toBe(true)
    expect(isLookupWorthy('look forward to')).toBe(true)
  })

  it('长得不像词条的就别白跑一趟了', () => {
    expect(isLookupWorthy('He stumbled over a stone in the dark.')).toBe(false)
  })

  it('空的不查', () => {
    expect(isLookupWorthy('')).toBe(false)
    expect(isLookupWorthy('   ')).toBe(false)
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

/**
 * 三级回退：真人录音 → 云端合成 → 系统引擎。
 *
 * 这一级是为「没有系统朗读引擎的设备」加的（用户的鸿蒙平板，见第五十七、五十八节）。
 * 那台机器上第三级永远是哑的，所以**第二级有没有被走到**就是全部 ——
 * 少了它，句子一句也读不出来。
 */
describe('三级回退', () => {
  function three(opts: { dictFails?: boolean; cloudFails?: boolean } = {}) {
    const log: string[] = []
    const system: Speaker = {
      speak: (t) => {
        log.push(`引擎念:${t}`)
        return Promise.resolve()
      },
      cancel: () => log.push('引擎停')
    }
    const player: DictPlayer = {
      play: (w) => {
        log.push(`录音:${w}`)
        return opts.dictFails ? Promise.reject(new Error('没有录音')) : Promise.resolve()
      },
      cancel: () => log.push('录音停')
    }
    const cloud: DictPlayer = {
      play: (t) => {
        log.push(`云端:${t}`)
        return opts.cloudFails ? Promise.reject(new Error('没配 key')) : Promise.resolve()
      },
      cancel: () => log.push('云端停')
    }
    return { log, speaker: createHumanFirstSpeaker(system, player, cloud) }
  }

  it('词有真人录音：就用录音，不碰云端，也不花调用次数', async () => {
    const { log, speaker } = three()
    await speaker.speak('hello', { lookup: true })
    expect(log.filter((l) => l.startsWith('云端:'))).toEqual([])
    expect(log.filter((l) => l.startsWith('引擎念'))).toEqual([])
  })

  it('词典里没有这个词：落到云端，**不再**直接掉到引擎', async () => {
    const { log, speaker } = three({ dictFails: true })
    await speaker.speak('zzqqxx', { lookup: true })
    expect(log).toContain('云端:zzqqxx')
    expect(log.filter((l) => l.startsWith('引擎念'))).toEqual([])
  })

  it('句子（不查词典）：直接走云端', async () => {
    const { log, speaker } = three()
    await speaker.speak('I never stood up very tall')
    expect(log.filter((l) => l.startsWith('录音:'))).toEqual([])
    expect(log).toContain('云端:I never stood up very tall')
  })

  it('云端也不行（没配 key / 额度没了 / 没网）：才轮到系统引擎', async () => {
    const { log, speaker } = three({ dictFails: true, cloudFails: true })
    await speaker.speak('zzqqxx', { lookup: true })
    expect(log.some((l) => l.startsWith('引擎念'))).toBe(true)
  })

  it('⚠️ 没传云端那一级时，老行为一点不变（录音 → 引擎）', async () => {
    const log: string[] = []
    const system: Speaker = {
      speak: (t) => {
        log.push(`引擎念:${t}`)
        return Promise.resolve()
      },
      cancel: () => {}
    }
    const player: DictPlayer = { play: () => Promise.reject(new Error('无')), cancel: () => {} }
    await createHumanFirstSpeaker(system, player).speak('x', { lookup: true })
    expect(log.some((l) => l.startsWith('引擎念'))).toBe(true)
  })

  it('按停时三级都要停下 —— 少停一级就是「按了停还在响」', () => {
    const { log, speaker } = three()
    speaker.cancel()
    expect(log).toContain('录音停')
    expect(log).toContain('云端停')
    expect(log).toContain('引擎停')
  })
})
