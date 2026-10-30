/**
 * Store 统一出口 + 启动引导
 *
 * 组件里一律 `import { useXxxStore } from '@renderer/stores'`，
 * 不要深到具体文件 —— 以后拆文件/改名不影响调用方。
 */
import { useAuthStore } from './auth'
import { useDatasetStore } from './dataset'
import { useThemeStore } from './theme'
import { useUiStore } from './ui'

export { useAuthStore, useDatasetStore, useThemeStore, useUiStore }

/**
 * 应用启动后调一次（必须 `app.use(pinia)` 之后）
 *
 * 两个 init 都是**不阻塞首屏**的：数据 store 先拿本地缓存渲染，
 * 认证 store 只影响"能不能写"，未登录也能正常浏览（D22）。
 * 所以这里故意不 await —— 谁先回来谁先更新界面。
 */
export function bootstrapStores(): void {
  void useDatasetStore().init()
  void useAuthStore().init()
}
