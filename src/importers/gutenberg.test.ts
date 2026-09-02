import { describe, it, expect } from 'vitest'
import { stripGutenbergBoilerplate } from './gutenberg'
import type { ImportedChapter } from './types'

const ch = (title: string, content: string): ImportedChapter => ({ title, content })

const START = '*** START OF THE PROJECT GUTENBERG EBOOK ALICE ***'
const END = '*** END OF THE PROJECT GUTENBERG EBOOK ALICE ***'

describe('stripGutenbergBoilerplate', () => {
  it('切掉界桩以外的内容，界桩那行本身也不留', () => {
    const out = stripGutenbergBoilerplate([
      ch('封面', ['The Project Gutenberg eBook of Alice', '许可条款一大堆', START, '正文第一行'].join('\n')),
      ch('尾页', ['正文最后一行', END, '完整授权协议', '捐款说明'].join('\n'))
    ])
    expect(out.map((c) => c.content)).toEqual(['正文第一行', '正文最后一行'])
  })

  it('两个界桩在同一章里也切得对（短篇都是这种）', () => {
    // 葛底斯堡演说就是这样：整本书只有一章，正文淹在四百行许可证里
    const out = stripGutenbergBoilerplate([
      ch('全文', ['头部声明', START, '八十七年前……', END, '尾部协议'].join('\n'))
    ])
    expect(out).toHaveLength(1)
    expect(out[0].content).toBe('八十七年前……')
  })

  it('整章都是版权声明的，剥完不留空章节', () => {
    const out = stripGutenbergBoilerplate([
      ch('封面', ['声明', START].join('\n')),
      ch('第一章', '真正的正文'),
      ch('尾页', [END, '协议'].join('\n'))
    ])
    expect(out.map((c) => c.title)).toEqual(['第一章'])
  })

  it('界桩之间的章节一个都不能少', () => {
    const out = stripGutenbergBoilerplate([
      ch('封面', START),
      ch('一', 'A'),
      ch('二', 'B'),
      ch('三', 'C'),
      ch('尾页', END)
    ])
    expect(out.map((c) => c.title)).toEqual(['一', '二', '三'])
  })

  it('没有界桩就原样返回 —— 用户自己写的东西绝不能瞎删', () => {
    const input = [ch('随手记', '今天天气不错'), ch('第二篇', 'hello world')]
    expect(stripGutenbergBoilerplate(input)).toEqual(input)
  })

  it('只有开头界桩、没有结尾的，也照样处理', () => {
    const out = stripGutenbergBoilerplate([ch('全文', ['声明', START, '正文'].join('\n'))])
    expect(out[0].content).toBe('正文')
  })

  it('认 THIS 那种写法（老书里有）', () => {
    const out = stripGutenbergBoilerplate([
      ch('全文', ['声明', '*** START OF THIS PROJECT GUTENBERG EBOOK X ***', '正文'].join('\n'))
    ])
    expect(out[0].content).toBe('正文')
  })

  it('剥完会变成空书时，宁可退回原样', () => {
    // 界桩位置反常（结尾在开头之前）时的兜底，交出一本空书比留着声明更糟
    const input = [ch('全文', [END, '协议', START].join('\n'))]
    expect(stripGutenbergBoilerplate(input)).toEqual(input)
  })

  it('剥完顺手去掉首尾多余的空行', () => {
    const out = stripGutenbergBoilerplate([
      ch('全文', ['声明', START, '', '', '正文', '', ''].join('\n'))
    ])
    expect(out[0].content).toBe('正文')
  })
})
