import { describe, it, expect } from 'vitest'
import { zipSync, strToU8 } from 'fflate'
import { epubImporter } from './epub'
import {
  readAttr,
  resolveRelative,
  parseContainer,
  parseOpf,
  parseToc,
  decodeEntities,
  htmlToText,
  extractDocTitle
} from './epubParts'

/**
 * EPUB 导入的测试。
 *
 * 零件（路径解析、XML 提取、HTML 转文本）各测各的，
 * 最后用 zip 现造一个真的 epub 跑通整条链路 —— 不是只测拼图碎片。
 */

describe('路径解析', () => {
  it('相对路径按 OPF 所在目录解析', () => {
    expect(resolveRelative('OEBPS/content.opf', 'text/ch1.xhtml')).toBe('OEBPS/text/ch1.xhtml')
    expect(resolveRelative('content.opf', 'ch1.xhtml')).toBe('ch1.xhtml')
  })

  it('处理 ../ 与 ./', () => {
    expect(resolveRelative('OEBPS/text/nav.xhtml', '../images/a.png')).toBe('OEBPS/images/a.png')
    expect(resolveRelative('OEBPS/content.opf', './ch1.xhtml')).toBe('OEBPS/ch1.xhtml')
  })

  it('去掉 #锚点，还原 %20 转义', () => {
    expect(resolveRelative('OEBPS/content.opf', 'ch1.xhtml#part2')).toBe('OEBPS/ch1.xhtml')
    expect(resolveRelative('OEBPS/content.opf', 'my%20file.xhtml')).toBe('OEBPS/my file.xhtml')
  })
})

describe('属性与实体', () => {
  it('属性顺序和引号种类都不影响', () => {
    expect(readAttr('<item href="a.xhtml" id="x"/>', 'id')).toBe('x')
    expect(readAttr("<item id='y' href='b.xhtml'/>", 'href')).toBe('b.xhtml')
  })

  it('实体还原：命名、十进制、十六进制', () => {
    expect(decodeEntities('a&amp;b')).toBe('a&b')
    expect(decodeEntities('&#39;quoted&#39;')).toBe("'quoted'")
    expect(decodeEntities('&#x27;hex&#x27;')).toBe("'hex'")
    expect(decodeEntities('&ldquo;中文&rdquo;')).toBe('“中文”')
  })
})

describe('HTML 转纯文本', () => {
  it('段落之间空一行：阅读器每行是一个块，不空行段落会挤在一起', () => {
    expect(htmlToText('<p>第一段</p><p>第二段</p>')).toBe('第一段\n\n第二段')
  })

  it('丢弃脚本、样式与文档头', () => {
    const html = '<head><title>T</title></head><body><script>bad()</script><style>x{}</style><p>正文</p></body>'
    expect(htmlToText(html)).toBe('正文')
  })

  it('br 与标题也换行，行内标签不换行', () => {
    expect(htmlToText('<p>a<br/>b</p>')).toBe('a\nb')
    expect(htmlToText('<p>粗<b>体</b>字</p>')).toBe('粗体字')
    expect(htmlToText('<h1>标题</h1><p>正文</p>')).toBe('标题\n\n正文')
  })

  it('多余空行折叠，首尾空白去掉', () => {
    expect(htmlToText('<div></div><div></div><p>  只有这句  </p><div></div>')).toBe('只有这句')
  })

  it('实体在正文里也能还原', () => {
    expect(htmlToText('<p>she&#39;s here &amp; now</p>')).toBe("she's here & now")
  })
})

describe('OPF 与目录', () => {
  const opf = `<?xml version="1.0"?>
    <package><metadata><dc:title>我的书</dc:title></metadata>
    <manifest>
      <item id="c1" href="text/ch1.xhtml" media-type="application/xhtml+xml"/>
      <item id="c2" href="text/ch2.xhtml" media-type="application/xhtml+xml"/>
      <item id="nav" href="text/nav.xhtml" media-type="application/xhtml+xml" properties="nav"/>
    </manifest>
    <spine><itemref idref="c1"/><itemref idref="c2"/></spine>
    </package>`

  it('取出书名、阅读顺序、目录位置', () => {
    const info = parseOpf(opf, 'OEBPS/content.opf')
    expect(info.title).toBe('我的书')
    expect(info.spine).toEqual(['OEBPS/text/ch1.xhtml', 'OEBPS/text/ch2.xhtml'])
    expect(info.tocPath).toBe('OEBPS/text/nav.xhtml')
  })

  it('spine 只收 manifest 里有的条目，顺序照 spine 来', () => {
    const reversed = opf.replace(
      '<spine><itemref idref="c1"/><itemref idref="c2"/></spine>',
      '<spine><itemref idref="c2"/><itemref idref="c1"/><itemref idref="missing"/></spine>'
    )
    expect(parseOpf(reversed, 'OEBPS/content.opf').spine).toEqual([
      'OEBPS/text/ch2.xhtml',
      'OEBPS/text/ch1.xhtml'
    ])
  })

  it('epub2 的 ncx 目录', () => {
    const ncx = `<ncx><navMap>
      <navPoint><navLabel><text>第一章 开端</text></navLabel><content src="ch1.xhtml"/></navPoint>
      <navPoint><navLabel><text>第二章 转折</text></navLabel><content src="ch2.xhtml#top"/></navPoint>
    </navMap></ncx>`
    const map = parseToc(ncx, 'OEBPS/toc.ncx')
    expect(map.get('OEBPS/ch1.xhtml')).toBe('第一章 开端')
    expect(map.get('OEBPS/ch2.xhtml')).toBe('第二章 转折')
  })

  it('epub3 的 nav 目录', () => {
    const nav = `<nav epub:type="toc"><ol>
      <li><a href="ch1.xhtml">Chapter One</a></li>
      <li><a href="ch2.xhtml">Chapter Two</a></li>
    </ol></nav>`
    const map = parseToc(nav, 'OEBPS/nav.xhtml')
    expect(map.get('OEBPS/ch1.xhtml')).toBe('Chapter One')
  })

  it('container.xml 指向 OPF', () => {
    const xml = `<container><rootfiles><rootfile full-path="OEBPS/content.opf" media-type="application/oebps-package+xml"/></rootfiles></container>`
    expect(parseContainer(xml)).toBe('OEBPS/content.opf')
  })

  it('正文里猜标题：h1 优先于 title', () => {
    expect(extractDocTitle('<head><title>忽略我</title></head><body><h1>真标题</h1></body>')).toBe('真标题')
    expect(extractDocTitle('<head><title>退而求其次</title></head><body><p>正文</p></body>')).toBe('退而求其次')
  })
})

/** 现造一个最小但合法的 epub */
function makeEpub(opts: { withToc?: boolean; emptyCover?: boolean } = {}): File {
  const files: Record<string, Uint8Array> = {
    'mimetype': strToU8('application/epub+zip'),
    'META-INF/container.xml': strToU8(
      `<container><rootfiles><rootfile full-path="OEBPS/content.opf"/></rootfiles></container>`
    ),
    'OEBPS/content.opf': strToU8(`<?xml version="1.0"?>
      <package><metadata><dc:title>三体</dc:title></metadata>
      <manifest>
        ${opts.emptyCover ? '<item id="cover" href="cover.xhtml" media-type="application/xhtml+xml"/>' : ''}
        <item id="c1" href="ch1.xhtml" media-type="application/xhtml+xml"/>
        <item id="c2" href="ch2.xhtml" media-type="application/xhtml+xml"/>
        ${opts.withToc ? '<item id="ncx" href="toc.ncx" media-type="application/x-dtbncx+xml"/>' : ''}
      </manifest>
      <spine ${opts.withToc ? 'toc="ncx"' : ''}>
        ${opts.emptyCover ? '<itemref idref="cover"/>' : ''}
        <itemref idref="c1"/><itemref idref="c2"/>
      </spine></package>`),
    'OEBPS/ch1.xhtml': strToU8(
      `<html><head><title>忽略</title></head><body><h1>Chapter One</h1><p>She&#39;s reading a book.</p><p>It was 1990.</p></body></html>`
    ),
    'OEBPS/ch2.xhtml': strToU8(
      `<html><body><h1>Chapter Two</h1><p>He said goodbye.</p></body></html>`
    )
  }
  if (opts.emptyCover) {
    files['OEBPS/cover.xhtml'] = strToU8('<html><body><div><img src="c.jpg"/></div></body></html>')
  }
  if (opts.withToc) {
    files['OEBPS/toc.ncx'] = strToU8(`<ncx><navMap>
      <navPoint><navLabel><text>第一章 相遇</text></navLabel><content src="ch1.xhtml"/></navPoint>
      <navPoint><navLabel><text>第二章 离别</text></navLabel><content src="ch2.xhtml"/></navPoint>
    </navMap></ncx>`)
  }
  return new File([zipSync(files) as unknown as BlobPart], '三体.epub', {
    type: 'application/epub+zip'
  })
}

describe('端到端：真的解一个 epub 包', () => {
  it('取出书名与各章正文', async () => {
    const result = await epubImporter.parse(makeEpub())

    expect(result.bookName).toBe('三体')
    expect(result.hasChapters).toBe(true)
    expect(result.chapters.map((c) => c.title)).toEqual(['Chapter One', 'Chapter Two'])
    expect(result.chapters[0].content).toBe("Chapter One\n\nShe's reading a book.\n\nIt was 1990.")
    expect(result.chapters[1].content).toBe('Chapter Two\n\nHe said goodbye.')
  })

  it('有目录时用目录里的章节名', async () => {
    const result = await epubImporter.parse(makeEpub({ withToc: true }))
    expect(result.chapters.map((c) => c.title)).toEqual(['第一章 相遇', '第二章 离别'])
  })

  it('跳过没有正文的封面页', async () => {
    const result = await epubImporter.parse(makeEpub({ emptyCover: true }))
    expect(result.chapters).toHaveLength(2)
    expect(result.chapters[0].title).toBe('Chapter One')
  })

  it('认得 .epub 文件', () => {
    expect(epubImporter.canHandle(new File([], 'a.epub'))).toBe(true)
    expect(epubImporter.canHandle(new File([], 'a.txt'))).toBe(false)
  })

  it('包损坏时给出可读的错误，而不是崩掉', async () => {
    const broken = new File([zipSync({ 'hello.txt': strToU8('hi') }) as unknown as BlobPart], 'x.epub')
    await expect(epubImporter.parse(broken)).rejects.toThrow(/container\.xml/)
  })
})
