import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { Capacitor } from '@capacitor/core'
import { registerSW } from 'virtual:pwa-register'
import App from './App'
import './index.css'

/*
 * 装成 app 跑的时候给 <html> 挂一个 native 标记。
 *
 * 只有 app 里才是沉浸式（网页铺到系统栏底下），也只有那时候才需要给状态栏留白。
 * 浏览器里没有系统栏，同一段留白会在页面顶上留一条白边。
 * 这个标记让样式表能分清两种场合，见 index.css 里的 .native。
 */
if (Capacitor.isNativePlatform()) {
  document.documentElement.classList.add('native')
}

registerSW({ immediate: true })

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>
)
