/// <reference types="vite/client" />

/** 打包时刻。设置页「开发者 → 系统栏参数」里显示（见 vite.config.ts） */
declare const __BUILD_STAMP__: string

declare module 'virtual:pwa-register' {
  export function registerSW(options?: { immediate?: boolean }): (reload?: boolean) => Promise<void>
}
