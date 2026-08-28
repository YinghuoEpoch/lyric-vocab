import type { Sentence } from './types'

export const SAMPLE_BOOK_ID = 'sample-book'
export const SAMPLE_PAGE_ID = 'sample-page'

/** 《Finding Paradise》插曲《Wish My Life Away》- 完整歌词，一行英文一行中文 */
export const YESTERDAY_ONCE_MORE = `I never stood up very tall
我从未挺起胸膛，伫立昂扬
I think my voice was fairly small
我想我的声音，也总是细若蚊响
But there were times I'd wanna shout
但即使如此，我也曾想放声呐喊
Though my thoughts weren't sorted out
哪怕思绪凌乱，未曾理清过往
So I'd stumble and I'd fall
所以我跌跌撞撞，遍体鳞伤
I learned to fly because of you
是你教会了我，如何飞翔
So if you left, I could go too
若你离去，我也愿随你流浪
And everything you saw in me
你眼中看到的那个我
That's what I wanted to be
正是我梦寐以求的模样
Did I make it after all?
最终，我做到了吗？
All the grass on the other side
那彼岸的芳草萋萋
Is it only greener in my mind?
是否只存在于我的幻想里？
I'd still want it the same
我依然愿一切如旧
Because trading my yesterday
因为若要用昨日去交换
Is to wish my life away
便是将我的一生虚度，遗忘
As we dream and as we grow
当我们追梦，当我们成长
We have to learn to let things go
总要学会放手，学会原谅
But let the wonder never fade
但愿心中的奇迹永不消亡
Though we've turned 10,000 pages
哪怕翻过万卷篇章
Flying high or stuck below
无论高飞云端，或受困泥沼
I've searched for meaning amidst doubt
我曾在迷茫中寻找意义
I've finally figured that part out
终于我也懂得了其中的真谛
And all the stories inside me
而我心中的所有故事
Feels like I'm bursting at the seams
仿佛要冲破胸膛，满溢而出
And you're here after all
毕竟，你一直都在这里`

/** 示例生词：按文中行号与单词序号 L行号W词序 */
export const SAMPLE_NOTES: Record<string, { word: string; phonetic?: string; pos?: string; definition?: string }> = {
  'L0W2': { word: 'stood', phonetic: '/stʊd/', pos: 'v.', definition: '站立；挺立（stand 过去式）' },
  'L8W2': { word: 'stumble', phonetic: '/ˈstʌmbl/', pos: 'v.', definition: '绊倒；跌跌撞撞' },
  'L10W1': { word: 'learned', phonetic: '/lɜːrnd/', pos: 'v.', definition: '学会；得知（learn 过去式）' },
  'L46W3': { word: 'bursting', phonetic: '/ˈbɜːrstɪŋ/', pos: 'v.', definition: '爆开；满溢（burst 现在分词）' }
}

const sampleDate = 1700000000000

/** 示例句摘：Is to wish my life away，带句型与翻译笔记 */
export const SAMPLE_SENTENCES: Sentence[] = [
  {
    id: 'sample-s2',
    text: 'Is to wish my life away',
    grammar: 'to wish one\'s life away：虚度一生、把日子“盼掉”（wish away 表示以愿望消磨掉）。',
    meaning: '便是将我的一生虚度，遗忘 / 指若总在盼望别处而忽视当下，就等于把人生浪费掉。',
    docId: SAMPLE_PAGE_ID,
    // 正确行号是 28（0-based），对应英文行 "Is to wish my life away"
    startAnchorId: 'L28W0',
    endAnchorId: 'L28W5',
    date: sampleDate
  }
]
