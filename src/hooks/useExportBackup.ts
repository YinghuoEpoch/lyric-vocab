
import { useCallback } from 'react'
import { Capacitor } from '@capacitor/core'
import { Filesystem, Directory, Encoding } from '@capacitor/filesystem'
import { Share } from '@capacitor/share'
import { getAppData } from '../storage'
import type { Sentence } from '../types'

// 与 App.tsx 中保持一致的本地存储 key
const SENTENCES_KEY = 'user_sentences'

/**
 * 导出备份 Hook。
 *
 * - Web：生成 JSON Blob + <a download> 下载
 * - 原生 App（Capacitor）：写入缓存目录，再通过 Share.share() 打开系统分享面板
 */
export function useExportBackup(): () => Promise<void> {
  const exportBackup = useCallback(async () => {
    try {
      const data = await getAppData()

      // 额外从 localStorage 读取句摘（Sentence）并一并写入备份 JSON
      let sentences: Sentence[] | undefined
      try {
        const raw = localStorage.getItem(SENTENCES_KEY)
        if (raw) {
          const parsed = JSON.parse(raw) as unknown
          if (Array.isArray(parsed)) {
            sentences = parsed.filter(
              (x: unknown): x is Sentence =>
                typeof x === 'object' &&
                x !== null &&
                typeof (x as Sentence).id === 'string' &&
                typeof (x as Sentence).text === 'string' &&
                typeof (x as Sentence).docId === 'string' &&
                typeof (x as Sentence).date === 'number'
            )
          }
        }
      } catch {
        // 句摘读取失败时忽略，不影响主数据备份
      }

      const payload = sentences ? { ...data, sentences } : data
      const json = JSON.stringify(payload, null, 2)

      if (Capacitor.isNativePlatform()) {
        const { uri } = await Filesystem.writeFile({
          path: 'backup.json',
          data: json,
          directory: Directory.Cache,
          encoding: Encoding.UTF8
        })

        await Share.share({
          url: uri,
          title: '文库备份',
          dialogTitle: '导出备份'
        })
      } else {
        const blob = new Blob([json], { type: 'application/json' })
        const a = document.createElement('a')
        a.href = URL.createObjectURL(blob)
        a.download = `文库备份-${new Date().toISOString().slice(0, 10)}.json`
        a.click()
        URL.revokeObjectURL(a.href)
      }
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e)
      window.alert('导出备份失败: ' + msg)
    }
  }, [])

  return exportBackup
}
