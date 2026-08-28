/// <reference types="vite/client" />

declare module 'virtual:pwa-register' {
  export function registerSW(options?: { immediate?: boolean }): (reload?: boolean) => Promise<void>
}
