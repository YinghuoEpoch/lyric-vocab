import { describe, it, expect } from 'vitest'
import { patchForMachineVoice } from './pronounceFix'
import { normalizeWord, dictAudioUrl } from './dictAudio'

/**
 * 两类「同一个词，写法差一点就出岔子」的测试。
 *
 * 撇号那条是真丢东西：弯撇号查不到录音，一整类缩写词白白落回机器音。
 * 冠词那条是读音不对：引擎把夹在中间的 a 当成字母名念。
 * 两条都不会报错，只会听着别扭 —— 所以只能靠测试守着。
 */

describe('弯撇号要换成直的，不然查不到录音', () => {
  it('弯的换成直的', () => {
    expect(normalizeWord('don’t')).toBe("don't")
    expect(normalizeWord('I’d')).toBe("I'd")
    expect(normalizeWord('wouldn’t have')).toBe("wouldn't have")
  })

  it('本来就是直的，原样不动', () => {
    expect(normalizeWord("don't")).toBe("don't")
  })

  it('两种写法拼出来的地址一模一样 —— 这才是重点', () => {
    expect(dictAudioUrl('don’t')).toBe(dictAudioUrl("don't"))
    expect(dictAudioUrl('it’s')).toBe(dictAudioUrl("it's"))
  })

  it('前后空格顺手去掉', () => {
    expect(normalizeWord('  stumble  ')).toBe('stumble')
  })
})

describe('冠词 a 改写给机器音', () => {
  it('夹在词中间的 a 换成 uh', () => {
    expect(patchForMachineVoice('with a thud')).toBe('with uh thud')
  })

  it('句首大写的 A 也换', () => {
    expect(patchForMachineVoice('A stone fell')).toBe('uh stone fell')
  })

  it('两头贴着标点也认得出来', () => {
    expect(patchForMachineVoice('it fell, a stone.')).toBe('it fell, uh stone.')
  })

  it('单独一个 a 不换 —— 那时候读字母音才是对的', () => {
    expect(patchForMachineVoice('a')).toBe('a')
    expect(patchForMachineVoice('  A  ')).toBe('A')
  })

  it('别的词一个都不动', () => {
    const s = 'He stumbled over a stone in the dark.'
    expect(patchForMachineVoice(s)).toBe('He stumbled over uh stone in the dark.')
  })

  it('词里面含 a 的不许被误伤', () => {
    expect(patchForMachineVoice('a lot of apples')).toBe('uh lot of apples')
    expect(patchForMachineVoice('and again')).toBe('and again')
  })

  it('空白照原样留着，不把间距搅乱', () => {
    expect(patchForMachineVoice('with  a  thud')).toBe('with  uh  thud')
  })
})
