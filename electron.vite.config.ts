import { resolve } from 'path'
import { defineConfig } from 'electron-vite'
import vue from '@vitejs/plugin-vue'

// @shared 指向主进程 / 预加载 / 渲染进程共用代码（类型、常量），三处都要配
const sharedAlias = { '@shared': resolve('src/shared') }

export default defineConfig({
  main: {
    resolve: { alias: { ...sharedAlias } }
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
