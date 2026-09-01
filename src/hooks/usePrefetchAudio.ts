import { useEffect } from 'react'
import { prefetchWords } from '../speech/prefetch'

/**
 * 复习页一打开就把这一页的词的录音备好。
 *
 * 背地里干，不拦任何东西；换一页或者离开复习页就停下 ——
 * 不然翻得快一点，几页的请求会叠在一起抢网。
 */
export function usePrefetchAudio(words: readonly string[], enabled: boolean): void {
  // 词的内容变了才重来；数组每次渲染都是新的，不能直接当依赖
  const fingerprint = words.join('\u0000')

  useEffect(() => {
    if (!enabled || !fingerprint) return
    let stopped = false
    void prefetchWords(fingerprint.split('\u0000'), { stopped: () => stopped })
    return () => {
      stopped = true
    }
  }, [enabled, fingerprint])
}
