import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { registerSW } from 'virtual:pwa-register'
import App from './App'
import { initSafeArea } from './safeArea'
import './index.css'

registerSW({ immediate: true })

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
