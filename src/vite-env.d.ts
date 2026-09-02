/// <reference types="vite/client" />

/** 打包时刻。⚠️ 临时，和设置页那块「系统栏」读数一起删（见 vite.config.ts） */
declare const __BUILD_STAMP__: string

declare module 'virtual:pwa-register' {
  export function registerSW(options?: { immediate?: boolean }): (reload?: boolean) => Promise<void>
}
