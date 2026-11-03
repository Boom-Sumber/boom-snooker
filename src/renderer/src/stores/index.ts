/**
 * Store 统一出口 + 启动引导
 *
 * 组件里一律 `import { useXxxStore } from '@renderer/stores'`，
 * 不要深到具体文件 —— 以后拆文件/改名不影响调用方。
 */
import { useAuthStore } from './auth'
import { useDatasetStore } from './dataset'
import { useNetworkStore } from './network'
import { useThemeStore } from './theme'
import { useUiStore } from './ui'

export { useAuthStore, useDatasetStore, useNetworkStore, useThemeStore, useUiStore }

/** 常用行类型一并从这里出，组件不用再深到 db.ts / shared */
export type { Advanced, Ball, DictRow, SyncState } from './dataset'
export type { AuthStatus } from './auth'
export type { Profile, RoleCode } from '@shared/auth'

/**
 * 应用启动后调一次（必须 `app.use(pinia)` 之后）
 *
 * 两个 init 都是**不阻塞首屏**的：数据 store 先拿本地缓存渲染，
 * 认证 store 只影响"能不能写"，未登录也能正常浏览（D22）。
 * 所以这里故意不 await —— 谁先回来谁先更新界面。
 */
export function bootstrapStores(): void {
  // 网络层先起来：重试动作就是"同步一次"，注入进去避免 stores 之间互相 import
  const network = useNetworkStore()
  network.setRetryHandler(() => useDatasetStore().sync())
  network.init()

  void useDatasetStore().init()
  void useAuthStore()
    .init()
    .then(() => {
      // 开发期自动登录（T3.5 有登录界面之前的过渡手段，生产构建不执行）
      void import('@renderer/dev/auto-login').then((module) => module.autoLoginIfConfigured())
    })
}
