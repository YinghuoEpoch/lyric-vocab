import { useCallback } from 'react'
import { Capacitor } from '@capacitor/core'
import { Filesystem, Directory, Encoding } from '@capacitor/filesystem'
import { Share } from '@capacitor/share'
import { getAppData } from '../storage'
import { buildSentenceList } from '../utils/annotationViews'

/**
 * 导出备份 Hook。
 *
 * - Web：生成 JSON Blob + <a download> 下载
 * - 原生 App（Capacitor）：写入缓存目录，再通过 Share.share() 打开系统分享面板
 *
 * 备份现在从**一个地方**取数据（主库的标注表）。
 * 从前要从主库 + localStorage 两处拼，很容易漏。
 *
 * 里面仍然额外写一份 sentences：那是旧形状，新版本用不到它，
 * 但万一要退回旧版本 APK，旧版本认得的正是这个字段。
 */
export function useExportBackup(): () => Promise<void> {
  const exportBackup = useCallback(async () => {
    try {
      const data = await getAppData()
      const payload = { ...data, sentences: buildSentenceList(data.annotations ?? []) }
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
