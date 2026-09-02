import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { Capacitor } from '@capacitor/core'
import { registerSW } from 'virtual:pwa-register'
import App from './App'
import { initSafeArea } from './safeArea'
import './index.css'

/*
 * 离线缓存（Service Worker）**只在浏览器里用**。
 *
 * 装成 app 之后它有害无益：网页文件本来就在安装包里，本地读，不缓存也一样快、
 * 一样能离线。可它偏偏会截住请求先给缓存里那一份 —— 于是**装了新版 APK，
 * 跑的还可能是上一版的网页**，代码明明改了、手机上「好像没有变化」。
 * 这个坑很难查，因为一切看起来都正常。
 *
 * 所以装成 app 时：不注册，并且把上一版留下来的那个注销掉、缓存删干净。
 * 注销之后当前这一页仍由旧 SW 管到刷新为止，下次启动就彻底干净了。
 */
if (Capacitor.isNativePlatform()) {
  void (async () => {
    try {
      const regs = await navigator.serviceWorker?.getRegistrations?.()
      await Promise.all((regs ?? []).map((r) => r.unregister()))
      const keys = await caches?.keys?.()
      await Promise.all((keys ?? []).map((k) => caches.delete(k)))
    } catch {
      // 删不掉就算了，不值得为它挡住启动
    }
  })()
} else {
  registerSW({ immediate: true })
}

function render() {
  createRoot(document.getElementById('root')!).render(
    <StrictMode>
      <App />
    </StrictMode>
  )
}

/*
 * 先把系统栏的尺寸问回来再渲染，第一帧就带着正确的留白 —— 否则顶栏会先画在 0 位置、
 * 拿到值再往下跳一下，看得见。
 *
 * ⚠️ 但**绝不能等它等到天荒地老**：万一原生那边不应答（插件没注册进去、
 * 旧版本 app 的网页壳跑在新版原生上……），界面就永远出不来了。
 * 所以最多等 500 毫秒，超时就先画出来 —— 留白走 CSS 里的保底，
 * 值晚一点到了也会自己补上（那时候顶多闪一下，总好过白屏）。
 */
Promise.race([initSafeArea(), new Promise((resolve) => setTimeout(resolve, 500))]).finally(render)
