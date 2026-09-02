import { gunzipSync, strFromU8 } from 'fflate'

/**
 * 内置的古登堡书目。
 *
 * **为什么目录是随 App 带着走的，而不是联网搜。**
 * 古登堡官方没有稳定可用的搜索接口（gutendex 那个第三方 API 实测时通时不通），
 * 而它的完整目录是一个静态文件，一次做好就能一直用。
 * 目录带在身上还顺带解决三件事：搜索是本地的所以秒出、不联网也能翻、
 * 网络环境差的时候不会卡在搜索这一步 —— 只有真的要下书时才需要网。
 *
 * 文件由 `scripts/buildGutenbergCatalog.py` 生成：原始 CSV 21MB、9 万条，
 * 砍成「编号 + 书名 + 作者」的英文正文书，6.1 万条，gz 后不到 2MB。
 */

export interface CatalogBook {
  /** 古登堡编号，下载地址由它拼出来 */
  id: number
  title: string
  author: string
}

/**
 * 读进内存的目录。
 *
 * `lines` 是原始文本行（`编号\t书名\t作者`），要用时才解析成对象 ——
 * 6 万条一上来就全建成对象，白白多占十几兆内存。
 * `folded` 是一一对应的小写版，省得每次搜索都把整份目录转一遍大小写。
 */
export interface Catalog {
  lines: string[]
  folded: string[]
}

/** 整个 App 共用这一份；`null` 表示还没加载 */
let catalog: Catalog | null = null
/** 同一次会话里只加载一次；并发调用共用同一个 Promise */
let loading: Promise<void> | null = null

export function parseCatalog(text: string): Catalog {
  const lines = text.split('\n').filter(Boolean)
  return { lines, folded: lines.map((l) => l.toLowerCase()) }
}

const CATALOG_URL = 'gutenberg-catalog.bin'

/** gzip 的文件头。见下面 `decode` 里的说明 */
function isGzip(bytes: Uint8Array): boolean {
  return bytes.length > 2 && bytes[0] === 0x1f && bytes[1] === 0x8b
}

/**
 * 拿到的字节可能已经被解开了，也可能没有。
 *
 * 有些服务器会带 `Content-Encoding: gzip` 把 .gz 发出来，浏览器收到时已经解好了；
 * 有些则当成普通二进制原样给。两种都得认 —— 认错一边就是整个目录读不出来。
 * 所以看文件头自己判断，不去猜服务器的行为。
 */
function decode(buf: ArrayBuffer): string {
  const bytes = new Uint8Array(buf)
  const text = strFromU8(isGzip(bytes) ? gunzipSync(bytes) : bytes)
  /**
   * 确认拿到的真是目录，不是一段 HTML。
   *
   * **这条不是防御性洁癖，是当场踩过的坑**：开发转发的前缀写成 `/gutenberg`，
   * 把 `/gutenberg-catalog.bin` 一并劫走转去了官网，回来的是人家的 404 页面。
   * 没有这道检查的话，HTML 会被当成目录一行行切开，搜索永远搜不到东西，
   * 界面上却一点错都不报 —— 这种静默失败最难查。
   * 同类风险还有 service worker 的兜底、公共 WiFi 的登录页。
   *
   * 目录每行都是「数字 + 制表符」开头，认这个就够了。
   */
  if (!/^\d+\t/.test(text)) throw new Error('书目文件的内容不对（可能被网络中途换掉了）')
  return text
}

/**
 * 把目录读进内存。
 *
 * 只在用户真的打开书库时才调用 —— 2MB 的文件加上解压，没必要拖慢启动。
 */
export function loadCatalog(): Promise<void> {
  if (catalog) return Promise.resolve()
  if (!loading) {
    loading = (async () => {
      const res = await fetch(CATALOG_URL)
      if (!res.ok) throw new Error(`读不到书目文件（${res.status}）`)
      catalog = parseCatalog(decode(await res.arrayBuffer()))
    })()
    // 失败了要能重试，不然一次抖动就让书库这一整个功能作废
    loading.catch(() => {
      loading = null
    })
  }
  return loading
}

export function catalogSize(): number {
  return catalog?.lines.length ?? 0
}

function parse(line: string): CatalogBook {
  const [id, title, author] = line.split('\t')
  return { id: Number(id), title: title ?? '', author: author ?? '' }
}

/**
 * 搜书。书名和作者都算数，空格分开的几个词要**全部**命中（顺序不限）——
 * 「austen pride」既能搜到，「pride austen」也一样。
 *
 * 6 万条挨个比对听着吓人，实测在手机上也是几毫秒的事：
 * 每行就是一次 indexOf，而且凑够 limit 条就停。
 */
export function searchCatalog(query: string, limit = 60): CatalogBook[] {
  return catalog ? searchIn(catalog, query, limit) : []
}

/** 搜索的实际逻辑。和上面分开，是为了不必真去加载 2MB 文件就能测 */
export function searchIn(cat: Catalog, query: string, limit = 60): CatalogBook[] {
  const terms = query.toLowerCase().split(/\s+/).filter(Boolean)
  if (terms.length === 0) return []

  const { lines, folded } = cat
  const hits: CatalogBook[] = []
  for (let i = 0; i < folded.length; i++) {
    const hay = folded[i]
    let ok = true
    for (const t of terms) {
      if (!hay.includes(t)) {
        ok = false
        break
      }
    }
    if (ok) {
      hits.push(parse(lines[i]))
      if (hits.length >= limit) break
    }
  }
  return hits
}
