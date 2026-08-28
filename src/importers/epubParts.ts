/**
 * epub 解析中不涉及解压的那些纯函数。
 *
 * 单独放一个文件是为了能直接测：它们只吃字符串、吐字符串，
 * 不依赖浏览器也不依赖 zip 库。
 */

/** 从一段标签里取某个属性的值，属性顺序、引号种类都不影响 */
export function readAttr(tag: string, name: string): string | undefined {
  const m = tag.match(new RegExp(`\\b${name}\\s*=\\s*["']([^"']*)["']`, 'i'))
  return m?.[1]
}

/**
 * 把相对路径解析成 zip 包内的完整路径。
 * epub 里 OPF 记录的路径是相对于 OPF 自己所在目录的。
 */
export function resolveRelative(basePath: string, href: string): string {
  // 去掉 #锚点，并还原 %20 之类的转义
  let target = href.split('#')[0]
  try {
    target = decodeURIComponent(target)
  } catch {
    // 本来就不是转义过的，保持原样
  }
  if (!target) return ''

  const baseDir = basePath.includes('/') ? basePath.slice(0, basePath.lastIndexOf('/')) : ''
  const segments = (baseDir ? baseDir.split('/') : []).concat(target.split('/'))
  const stack: string[] = []

  for (const seg of segments) {
    if (!seg || seg === '.') continue
    if (seg === '..') stack.pop()
    else stack.push(seg)
  }
  return stack.join('/')
}

/** container.xml -> OPF 文件在包内的路径 */
export function parseContainer(xml: string): string | null {
  const tag = xml.match(/<rootfile\b[^>]*>/i)?.[0]
  if (!tag) return null
  return readAttr(tag, 'full-path') ?? null
}

export interface OpfInfo {
  /** 书名，取自 dc:title */
  title: string | null
  /** 正文文件在包内的完整路径，已按阅读顺序排好 */
  spine: string[]
  /** 目录文件（epub3 的 nav 或 epub2 的 ncx）在包内的完整路径 */
  tocPath: string | null
}

/**
 * 解析 OPF：书名、阅读顺序、目录文件位置。
 *
 * spine 里记的是 manifest 的 id，要先在 manifest 里查出对应的文件路径。
 */
export function parseOpf(xml: string, opfPath: string): OpfInfo {
  const title = xml.match(/<dc:title\b[^>]*>([\s\S]*?)<\/dc:title>/i)?.[1]?.trim() || null

  // manifest: id -> { href, mediaType, properties }
  const manifest = new Map<string, { href: string; mediaType: string; properties: string }>()
  for (const tag of xml.match(/<item\b[^>]*>/gi) ?? []) {
    const id = readAttr(tag, 'id')
    const href = readAttr(tag, 'href')
    if (!id || !href) continue
    manifest.set(id, {
      href,
      mediaType: readAttr(tag, 'media-type') ?? '',
      properties: readAttr(tag, 'properties') ?? ''
    })
  }

  const spine: string[] = []
  for (const tag of xml.match(/<itemref\b[^>]*>/gi) ?? []) {
    const idref = readAttr(tag, 'idref')
    if (!idref) continue
    const item = manifest.get(idref)
    if (!item) continue
    spine.push(resolveRelative(opfPath, item.href))
  }

  // 目录：epub3 在 manifest 里用 properties="nav" 标注；epub2 用 spine 的 toc 属性指向 ncx
  let tocPath: string | null = null
  for (const [, item] of manifest) {
    if (item.properties.split(/\s+/).includes('nav')) {
      tocPath = resolveRelative(opfPath, item.href)
      break
    }
  }
  if (!tocPath) {
    const spineTag = xml.match(/<spine\b[^>]*>/i)?.[0]
    const tocId = spineTag ? readAttr(spineTag, 'toc') : undefined
    const ncx = tocId ? manifest.get(tocId) : undefined
    if (ncx) tocPath = resolveRelative(opfPath, ncx.href)
  }

  return { title, spine, tocPath }
}

/**
 * 解析目录，得到「正文文件路径 -> 章节标题」。
 * 同时支持 epub3 的 nav.xhtml 和 epub2 的 toc.ncx。
 */
export function parseToc(xml: string, tocPath: string): Map<string, string> {
  const map = new Map<string, string>()

  // epub2 的 ncx：<navPoint><navLabel><text>标题</text></navLabel><content src="路径"/>
  const navPoints = xml.match(/<navPoint\b[\s\S]*?<\/navPoint>/gi) ?? []
  for (const point of navPoints) {
    const text = point.match(/<text\b[^>]*>([\s\S]*?)<\/text>/i)?.[1]
    const srcTag = point.match(/<content\b[^>]*>/i)?.[0]
    const src = srcTag ? readAttr(srcTag, 'src') : undefined
    if (!text || !src) continue
    const path = resolveRelative(tocPath, src)
    if (path && !map.has(path)) map.set(path, decodeEntities(text).trim())
  }
  if (map.size > 0) return map

  // epub3 的 nav：<a href="路径">标题</a>
  for (const anchor of xml.match(/<a\b[^>]*href\s*=\s*["'][^"']*["'][^>]*>[\s\S]*?<\/a>/gi) ?? []) {
    const href = readAttr(anchor, 'href')
    const text = anchor.replace(/<[^>]+>/g, '')
    if (!href || !text.trim()) continue
    const path = resolveRelative(tocPath, href)
    if (path && !map.has(path)) map.set(path, decodeEntities(text).trim())
  }
  return map
}

const NAMED_ENTITIES: Record<string, string> = {
  amp: '&',
  lt: '<',
  gt: '>',
  quot: '"',
  apos: "'",
  nbsp: ' ',
  ldquo: '“',
  rdquo: '”',
  lsquo: '‘',
  rsquo: '’',
  hellip: '…',
  mdash: '—',
  ndash: '–'
}

/** 还原 HTML 实体（&amp; &#39; &#x27; 之类） */
export function decodeEntities(text: string): string {
  return text
    .replace(/&#x([0-9a-f]+);/gi, (_, hex) => String.fromCodePoint(parseInt(hex, 16)))
    .replace(/&#(\d+);/g, (_, dec) => String.fromCodePoint(parseInt(dec, 10)))
    .replace(/&([a-z]+);/gi, (whole, name) => NAMED_ENTITIES[name.toLowerCase()] ?? whole)
}

/** 这些标签意味着「另起一行」 */
const BLOCK_TAGS = 'p|div|br|h[1-6]|li|tr|blockquote|section|article|hr|pre|figcaption|td|dd|dt'

/**
 * 把一份 XHTML 正文转成纯文本。
 *
 * 保留段落换行（app 的笔记坐标是按行算的，行的划分不能丢），
 * 其余标签一律去掉。
 */
export function htmlToText(html: string): string {
  let s = html

  s = s.replace(/<\?xml[\s\S]*?\?>/gi, '')
  s = s.replace(/<!--[\s\S]*?-->/g, '')
  s = s.replace(/<!DOCTYPE[^>]*>/gi, '')
  // 整段丢弃：脚本、样式、文档头
  s = s.replace(/<(script|style|head)\b[\s\S]*?<\/\1\s*>/gi, '')

  // 块级标签换成换行
  s = s.replace(new RegExp(`<(?:${BLOCK_TAGS})\\b[^>]*>`, 'gi'), '\n')
  s = s.replace(new RegExp(`</(?:${BLOCK_TAGS})\\s*>`, 'gi'), '\n')
  // 其余标签直接抹掉
  s = s.replace(/<[^>]*>/g, '')

  s = decodeEntities(s)

  // 规整空白：每行去首尾空格、多个空格并一个、最多留一个空行
  s = s
    .replace(/\r\n?/g, '\n')
    .split('\n')
    .map((line) => line.replace(/[ \t ]+/g, ' ').trim())
    .join('\n')
    .replace(/\n{3,}/g, '\n\n')

  return s.trim()
}

/** 从正文文件里猜一个标题：优先 h1/h2，其次 <title> */
export function extractDocTitle(html: string): string | null {
  for (const re of [/<h1\b[^>]*>([\s\S]*?)<\/h1>/i, /<h2\b[^>]*>([\s\S]*?)<\/h2>/i, /<title\b[^>]*>([\s\S]*?)<\/title>/i]) {
    const raw = html.match(re)?.[1]
    if (!raw) continue
    const text = decodeEntities(raw.replace(/<[^>]*>/g, '')).trim()
    if (text) return text
  }
  return null
}
