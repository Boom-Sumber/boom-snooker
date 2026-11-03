import { resolve } from 'path'
import { defineConfig } from 'electron-vite'
import vue from '@vitejs/plugin-vue'

// @shared 指向主进程 / 预加载 / 渲染进程共用代码（类型、常量），三处都要配
const sharedAlias = { '@shared': resolve('src/shared') }

export default defineConfig({
  main: {
    resolve: { alias: { ...sharedAlias } },
    // 主进程要读 `VITE_SUPABASE_URL`（图片缓存协议拼远程地址，见 src/main/media.ts）。
    // electron-vite 默认只注入 `MAIN_VITE_*`，这里把 `VITE_` 也放进来，
    // 避免同一个值在 .env.local 里写两遍、改一处漏一处。
    envPrefix: ['MAIN_VITE_', 'VITE_']
  },
  preload: {
    resolve: { alias: { ...sharedAlias } }
  },
  renderer: {
    resolve: {
      alias: {
        '@renderer': resolve('src/renderer/src'),
        ...sharedAlias
      }
    },
    plugins: [vue()]
  }
})
