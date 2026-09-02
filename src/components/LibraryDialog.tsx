import { useEffect, useMemo, useRef, useState } from 'react'
import { BookOpen, Download, Loader2, Search, X } from 'lucide-react'
import { catalogSize, loadCatalog, searchCatalog, type CatalogBook } from '../library/catalog'
import {
  asEpubFile,
  fetchBookEpub,
  NoEpub,
  type DownloadProgress
} from '../library/download'
import { useBackHandler, BackPriority } from '../hooks/useBackHandler'

/**
 * 「书库」—— 在古登堡的六万多本公版英文书里搜，选中直接下载导入。
 *
 * 这是为了解决「App 太像个工具」：从前必须自己在别处找到内容、再搬进来，
 * App 自己一本书都没有。
 *
 * **搜索是本地的**（目录随 App 带着走，见 library/catalog.ts），
 * 只有真的下载那一下才需要网。下下来的字节包成 File 交给现成的导入流程，
 * 所以章节切分、异常提示这些一概不用重写。
 */

/**
 * 把下载失败翻译成人话。
 *
 * 第一版直接把原始异常甩在界面上，用户看到的是
 * `unexpected end of stream on com.android.okhttp.Address@f3518f8e` ——
 * 这句话对他没有任何用处，也不告诉他下一步该干嘛。
 */
function formatSize(bytes: number): string {
  return bytes < 1024 * 1024
    ? `${Math.round(bytes / 1024)} KB`
    : `${(bytes / 1024 / 1024).toFixed(1)} MB`
}

function describeError(e: unknown): string {
  const raw = e instanceof Error ? e.message : String(e)
  if (e instanceof NoEpub) {
    return '这本书取不到，可能古登堡那边没存 epub。换一本试试'
  }
  // 连接被掐断这一类：三个源、每段重试三次都没成
  if (/end of stream|timeout|timed out|Failed to connect|Unable to resolve/i.test(raw)) {
    return '网络不稳，没下完。连上 Wi-Fi 再试一次，或者过一会儿再来'
  }
  return '下载失败：' + raw
}

interface LibraryDialogProps {
  open: boolean
  onClose: () => void
  /** 下好的书交给上层，走的是和「从手机选文件」完全相同的那条导入路 */
  onImport: (file: File) => void
}

type Phase = 'loading' | 'ready' | 'failed'

export function LibraryDialog({ open, onClose, onImport }: LibraryDialogProps) {
  const [phase, setPhase] = useState<Phase>('loading')
  const [query, setQuery] = useState('')
  /** 正在下载的那本书的编号，同时也用来禁掉其它条目 */
  const [downloading, setDownloading] = useState<number | null>(null)
  /** 下载进度。手机上分段取，能报得出来 */
  const [progress, setProgress] = useState<DownloadProgress | null>(null)
  const [error, setError] = useState('')
  const inputRef = useRef<HTMLInputElement>(null)

  useBackHandler(open, BackPriority.settings, onClose)

  // 目录只在真的打开书库时才加载 —— 2MB 加解压，没必要拖慢 App 启动
  useEffect(() => {
    if (!open) return
    let alive = true
    setPhase(catalogSize() > 0 ? 'ready' : 'loading')
    loadCatalog().then(
      () => alive && setPhase('ready'),
      (e: unknown) => {
        if (!alive) return
        setError(e instanceof Error ? e.message : String(e))
        setPhase('failed')
      }
    )
    return () => {
      alive = false
    }
  }, [open])

  useEffect(() => {
    if (open && phase === 'ready') inputRef.current?.focus()
  }, [open, phase])

  const results = useMemo(
    () => (phase === 'ready' ? searchCatalog(query.trim()) : []),
    [query, phase]
  )

  if (!open) return null

  const handlePick = (book: CatalogBook) => {
    if (downloading !== null) return
    setDownloading(book.id)
    setProgress(null)
    setError('')
    void (async () => {
      try {
        const bytes = await fetchBookEpub(book.id, setProgress)
        onImport(asEpubFile(bytes, book.title))
        onClose()
      } catch (e) {
        setError(describeError(e))
      } finally {
        setDownloading(null)
        setProgress(null)
      }
    })()
  }

  return (
    <div
      className="fixed inset-0 z-[100] flex items-center justify-center bg-black/40 p-4"
      onClick={() => downloading === null && onClose()}
    >
      <div
        className="flex max-h-[85vh] w-[90%] max-w-sm flex-col gap-3 rounded-2xl border border-paper-border bg-white p-4 shadow-xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between">
          <h2 className="flex items-center gap-2 text-base font-semibold text-ink">
            <BookOpen className="h-4 w-4 text-accent-600" />
            书库
          </h2>
          {downloading === null && (
            <button
              type="button"
              onClick={onClose}
              className="rounded p-1 text-ink-muted hover:bg-stone-100"
              aria-label="关闭"
            >
              <X className="h-4 w-4" />
            </button>
          )}
        </div>

        {phase === 'loading' && (
          <p className="flex items-center gap-2 py-6 text-sm text-ink-muted">
            <Loader2 className="h-4 w-4 animate-spin" />
            正在打开书目…
          </p>
        )}

        {phase === 'failed' && (
          <p className="py-6 text-sm text-red-600">读不到书目文件：{error}</p>
        )}

        {phase === 'ready' && (
          <>
            <div className="flex items-center gap-2 rounded-lg border border-paper-border px-2.5">
              <Search className="h-4 w-4 shrink-0 text-ink-muted" aria-hidden />
              <input
                ref={inputRef}
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder="书名或作者，英文"
                className="h-9 min-w-0 flex-1 bg-transparent text-sm text-ink outline-none placeholder:text-ink-muted"
              />
            </div>

            <div className="-mx-1 min-h-0 flex-1 overflow-y-auto px-1">
              {query.trim() === '' ? (
                <p className="py-6 text-center text-xs leading-relaxed text-ink-muted">
                  共 {catalogSize().toLocaleString()} 本免费英文书
                  <br />
                  都是版权已过期的经典，可以放心下载
                  <br />
                  <span className="mt-2 inline-block">建议连 Wi-Fi 下载，用流量会慢很多</span>
                </p>
              ) : results.length === 0 ? (
                <p className="py-6 text-center text-sm text-ink-muted">没搜到</p>
              ) : (
                <ul className="space-y-px">
                  {results.map((b) => (
                    <li key={b.id}>
                      <button
                        type="button"
                        onClick={() => handlePick(b)}
                        disabled={downloading !== null}
                        className="flex w-full items-center gap-2 rounded-lg px-2 py-2 text-left transition-colors hover:bg-stone-50 disabled:opacity-50"
                      >
                        <span className="min-w-0 flex-1">
                          <span className="block truncate text-sm text-ink">{b.title}</span>
                          {b.author && (
                            <span className="block truncate text-xs text-ink-muted">
                              {b.author}
                            </span>
                          )}
                        </span>
                        {downloading === b.id ? (
                          <Loader2 className="h-4 w-4 shrink-0 animate-spin text-accent-600" />
                        ) : (
                          <Download className="h-4 w-4 shrink-0 text-ink-muted" aria-hidden />
                        )}
                      </button>
                    </li>
                  ))}
                </ul>
              )}
            </div>

            {downloading !== null && (
              <div className="space-y-1">
                <p className="text-xs text-ink-muted">
                  {progress
                    ? `正在下载… ${formatSize(progress.loaded)}${
                        progress.total ? ` / ${formatSize(progress.total)}` : ''
                      }`
                    : '正在下载，书越厚等得越久…'}
                </p>
                {progress?.total ? (
                  <div className="h-1 overflow-hidden rounded-full bg-stone-200">
                    <div
                      className="h-full bg-accent-500 transition-all duration-300"
                      style={{
                        width: `${Math.min(100, (progress.loaded / progress.total) * 100)}%`
                      }}
                    />
                  </div>
                ) : null}
              </div>
            )}
            {error && <p className="text-xs leading-relaxed text-red-600">{error}</p>}
          </>
        )}
      </div>
    </div>
  )
}
