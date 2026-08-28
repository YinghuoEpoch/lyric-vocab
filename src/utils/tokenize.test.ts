import { describe, it, expect } from 'vitest'
import { tokenizeLine } from './tokenize'
import { buildWordList, joinWords } from './reconcile'

/**
 * 分词规则的回归测试。
 *
 * 词的边界直接决定笔记挂在哪儿，所以这里的每一条都在守着数据安全：
 * 「词的数量」一旦变了，全库笔记就会错位。
 */

/** 只取英文词，便于断言 */
const words = (s: string) => tokenizeLine(s).filter((x) => x.type === 'en').map((x) => x.text)
/** 完整片段，用来确认拆出去的后缀确实变成了标点而不是第二个词 */
const segs = (s: string) => tokenizeLine(s).map((x) => `${x.type}:${x.text}`)

describe('撇号：能单独选中前面的词', () => {
  it("she's 拆成词 she + 标点 's（直撇号）", () => {
    expect(segs("she's")).toEqual(['en:she', "other:'s"])
    expect(words("she's")).toEqual(['she'])
  })

  it('she’s 用弯撇号时结果完全一致', () => {
    expect(segs('she’s')).toEqual(['en:she', 'other:’s'])
    expect(words('she’s')).toEqual(['she'])
  })

  it('两种撇号在各类缩写上都表现一致', () => {
    for (const apo of ["'", '’']) {
      expect(words(`I${apo}d`)).toEqual(['I'])
      expect(words(`we${apo}ve`)).toEqual(['we'])
      expect(words(`they${apo}ll`)).toEqual(['they'])
      expect(words(`it${apo}s`)).toEqual(['it'])
    }
  })

  it("don't 从 n 前面拆，得到 do 而不是 don", () => {
    expect(segs("don't")).toEqual(['en:do', "other:n't"])
    expect(words("isn't")).toEqual(['is'])
    expect(words("aren't")).toEqual(['are'])
    expect(words("didn't")).toEqual(['did'])
  })

  it("can't / won't 属于不规则缩写，整体保留（拆开会得到 ca / wo 这种垃圾）", () => {
    expect(words("can't")).toEqual(["can't"])
    expect(words("won't")).toEqual(["won't"])
  })

  it('所有格 students’ 的尾撇号不粘连', () => {
    expect(segs("students'")).toEqual(['en:students', "other:'"])
  })

  it("O'Brien、o'clock 不是缩写，不拆", () => {
    expect(words("O'Brien")).toEqual(["O'Brien"])
    expect(words("o'clock")).toEqual(["o'clock"])
  })

  it("rock 'n' roll 里落单的撇号不粘到词上", () => {
    expect(words("rock 'n' roll")).toEqual(['rock', 'n', 'roll'])
  })
})

describe('数字与连字符', () => {
  it('COVID-19 是一个完整的词（旧规则会切成 COVID- 和游离的 19）', () => {
    expect(words('COVID-19')).toEqual(['COVID-19'])
  })

  it('1990s、3rd 这类字母数字混排是一个词', () => {
    expect(words('1990s')).toEqual(['1990s'])
    expect(words('3rd')).toEqual(['3rd'])
  })

  it('纯数字不算单词，避免年份章节号变成噪音', () => {
    expect(words('2026')).toEqual([])
    expect(words('Chapter 12')).toEqual(['Chapter'])
    expect(words('3-4')).toEqual([])
  })

  it('复合词照旧是一个词，落单的连字符不算词', () => {
    expect(words('merry-go-round')).toEqual(['merry-go-round'])
    expect(words('well-known')).toEqual(['well-known'])
    expect(words('a - b')).toEqual(['a', 'b'])
  })

  it('词尾的连字符不粘连', () => {
    expect(segs('COVID- ')).toEqual(['en:COVID', 'other:- '])
  })
})

describe('中英混排与词编号', () => {
  it('中文不参与英文词编号', () => {
    expect(buildWordList('I never stood\n我从未挺起胸膛\nBut there').map((w) => w.anchorId)).toEqual([
      'L0W0',
      'L0W1',
      'L0W2',
      'L2W0',
      'L2W1'
    ])
  })

  it("拆出来的后缀不占词编号（she's up 仍是两个词）", () => {
    expect(buildWordList("she's up").map((w) => `${w.anchorId}=${w.word}`)).toEqual([
      'L0W0=she',
      'L0W1=up'
    ])
  })

  it('重音字母仍算词内字符', () => {
    expect(words('mère café')).toEqual(['mère', 'café'])
  })
})

describe('划句子时要还原出可读的原文', () => {
  /** 模拟「从第一个词划到最后一个词」得到的句摘原文 */
  const rangeText = (line: string) => joinWords(buildWordList(line))

  it("缩写不能在拼回句子时丢掉（曾经拼成 I do know she here）", () => {
    expect(rangeText("I don't know she's here")).toBe("I don't know she's here")
  })

  it('弯撇号同样还原得回来', () => {
    expect(rangeText('she’s gone')).toBe('she’s gone')
  })

  it('所有格与不规则缩写也不丢', () => {
    expect(rangeText("the students' books")).toBe("the students' books")
    expect(rangeText("we can't stay")).toBe("we can't stay")
  })

  it("rock 'n' roll 里贴着词的撇号也能还原", () => {
    expect(rangeText("rock 'n' roll")).toBe("rock 'n' roll")
  })

  it('后缀只跟着自己的词，不会串到别的词上', () => {
    const words = buildWordList("it's a test")
    expect(words.map((w) => `${w.word}|${w.suffix ?? ''}`)).toEqual([
      "it|'s",
      'a|',
      'test|'
    ])
  })

  it('还原原文不影响单词本身（笔记记的仍是 she 不是 she’s）', () => {
    const words = buildWordList("she's here")
    expect(words.map((w) => w.word)).toEqual(['she', 'here'])
  })
})
