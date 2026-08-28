import { describe, it, expect } from 'vitest'
import { splitChapters } from './txt'

/**
 * 章节切分的回归测试。
 *
 * 这段逻辑从前埋在 App.tsx 的回调里，改动只能靠真的导入一个文件来验证；
 * 抽成纯函数之后就能直接测了。
 */

const titles = (raw: string) => splitChapters(raw, '兜底书名').chapters.map((c) => c.title)
const bodies = (raw: string) => splitChapters(raw, '兜底书名').chapters.map((c) => c.content)

describe('中文章节', () => {
  it('按「第 N 章」切分，标题与正文分别归位', () => {
    const raw = ['第一章 开端', '正文甲', '第二章 转折', '正文乙'].join('\n')
    expect(titles(raw)).toEqual(['第一章 开端', '第二章 转折'])
    expect(bodies(raw)).toEqual(['正文甲', '正文乙'])
  })

  it('回 / 节 / 卷 / 集 / 部 同样识别', () => {
    for (const unit of ['回', '节', '卷', '集', '部']) {
      const raw = `第3${unit} 标题\n内容`
      expect(splitChapters(raw, 'x').hasChapters).toBe(true)
    }
  })

  it('阿拉伯数字与中文数字都认', () => {
    expect(splitChapters('第12章\n内容', 'x').hasChapters).toBe(true)
    expect(splitChapters('第一百二十章\n内容', 'x').hasChapters).toBe(true)
  })
})

describe('英文与其它标题格式', () => {
  it('Chapter / Part / Session / Markdown 三级标题', () => {
    const raw = [
      'Chapter One',
      'body a',
      'Part Two',
      'body b',
      'Session 3',
      'body c',
      '### Notes',
      'body d'
    ].join('\n')
    expect(titles(raw)).toEqual(['Chapter One', 'Part Two', 'Session 3', '### Notes'])
  })

  it('宽间距的 C H A P T E R 也识别（某些排版会把字母拆开）', () => {
    expect(splitChapters('C H A P T E R  1\n内容', 'x').hasChapters).toBe(true)
  })
})

describe('没有章节时的兜底', () => {
  it('整篇作为一个文档，标题用传入的兜底名，并标记 hasChapters=false', () => {
    const r = splitChapters('就是一段普通文字\n没有任何章节标题', '我的文件')
    expect(r.hasChapters).toBe(false)
    expect(r.chapters).toHaveLength(1)
    expect(r.chapters[0].title).toBe('我的文件')
    expect(r.chapters[0].content).toContain('就是一段普通文字')
  })
})

describe('边角情况', () => {
  it('Windows 换行符会被规整，不影响切分', () => {
    const raw = '第一章 甲\r\n正文\r\n第二章 乙\r\n正文'
    expect(titles(raw)).toEqual(['第一章 甲', '第二章 乙'])
    expect(bodies(raw).every((b) => !b.includes('\r'))).toBe(true)
  })

  it('标题下没有正文时不产生空章节', () => {
    const raw = ['第一章 空的', '第二章 有内容', '正文'].join('\n')
    expect(titles(raw)).toEqual(['第二章 有内容'])
  })

  it('正文前的引言部分会被丢弃（第一个标题之前的内容）', () => {
    const raw = ['这是没有标题的引言', '第一章 开始', '正文'].join('\n')
    expect(titles(raw)).toEqual(['第一章 开始'])
    expect(bodies(raw)).toEqual(['正文'])
  })

  it('空文本不会崩', () => {
    const r = splitChapters('', '空文件')
    expect(r.hasChapters).toBe(false)
    expect(r.chapters).toHaveLength(1)
  })

  it('连续调用互不干扰（正则的 lastIndex 每次都重置）', () => {
    const raw = '第一章 甲\n正文'
    expect(titles(raw)).toEqual(['第一章 甲'])
    expect(titles(raw)).toEqual(['第一章 甲'])
    expect(titles(raw)).toEqual(['第一章 甲'])
  })
})
