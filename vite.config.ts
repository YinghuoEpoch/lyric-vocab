import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { VitePWA } from 'vite-plugin-pwa'

export default defineConfig({
  /**
   * 开发时把取发音的请求转一道手。
   *
   * 词典那个地址不带跨域许可，浏览器里直接 fetch 会被拦（试过，报 Failed to fetch），
   * 于是「把录音存下来」这段在电脑上就没法验 —— 而这个项目栽过的跟头都是
   * 「只在一边验过」。手机上不走这里：那边用的是 Capacitor 的原生网络，
   * 请求由安卓发出，压根没有跨域这回事。**这条只在开发时生效，跟打包出去的 App 无关。**
   */
  server: {
    proxy: {
      '/dictvoice': {
        target: 'https://dict.youdao.com',
        changeOrigin: true
      },
      /**
       * 同理，古登堡下载书也不带跨域许可。手机上走原生网络，不经过这里。
       *
       * **末尾这个斜杠不能少。** 写成 `/gutenberg` 是按前缀匹配的，
       * 会把 `/gutenberg-catalog.bin`（内置书目那个文件）一并劫走转去官网，
       * 于是书目永远读不出来 —— 而且拿回来的是人家的 404 页面，
       * 状态码和内容都对不上，查起来很费劲。这个坑当场踩过一次。
       */
      '/gutenberg/': {
        target: 'https://www.gutenberg.org',
        changeOrigin: true,
        rewrite: (p) => p.replace(/^\/gutenberg/, '')
      }
    }
  },
  plugins: [
    react(),
    VitePWA({
      registerType: 'autoUpdate',
      includeAssets: ['favicon.svg', 'icon-192.svg', 'icon-512.svg'],
      manifest: {
        name: '我的文库',
        short_name: 'Vocab',
        description: 'A minimalist vocabulary builder based on lyrics.',
        theme_color: '#ffffff',
        background_color: '#fbfcf8',
        display: 'standalone',
        start_url: '/',
        scope: '/',
        icons: [
          {
            src: '/icon-192.svg',
            sizes: '192x192',
            type: 'image/svg+xml',
            purpose: 'any maskable'
          },
          {
            src: '/icon-512.svg',
            sizes: '512x512',
            type: 'image/svg+xml',
            purpose: 'any maskable'
          }
        ]
      },
      workbox: {
        globPatterns: ['**/*.{js,css,html,ico,png,svg,woff2,woff}'],
        runtimeCaching: [
          {
            urlPattern: /^https:\/\/fonts\.(googleapis|gstatic)\.com\/.*/i,
            handler: 'CacheFirst',
            options: {
              cacheName: 'google-fonts',
              expiration: { maxEntries: 20, maxAgeSeconds: 60 * 60 * 24 * 365 },
              cacheableResponse: { statuses: [0, 200] }
            }
          }
        ]
      },
      devOptions: { enabled: true }
    })
  ]
})
