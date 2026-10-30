/**
 * 主题 store
 *
 * 只是 `@renderer/theme` 的 Pinia 外壳 —— **状态不在这里另存一份**。
 * 主题的真身（`mode` / `isDark` 两个 ref + `document.documentElement` 上的
 * `dark` class）仍在 `theme/index.ts`，因为那里要处理 media 监听和"首帧不闪"，
 * 必须在 createApp 之前就跑起来，塞进 store 反而绕。
 *
 * 两层分工：
 *   - `theme/index.ts`：上色逻辑、与主进程 nativeTheme 同步（唯一数据源）
 *   - 本 store：给组件一个 `useThemeStore()` 的入口，组件不直接 import 模块函数
 */
import { defineStore } from 'pinia'
import { setThemeMode, themeIsDark, themeMode } from '@renderer/theme'
import type { ThemeMode } from '@shared/types/theme'

export const useThemeStore = defineStore('theme', () => {
  const mode = themeMode
  const isDark = themeIsDark

  /** 亮 ↔ 暗 直接切换（顶部栏太阳/月亮按钮） */
  async function toggle(): Promise<void> {
    await setThemeMode(isDark.value ? 'light' : 'dark')
  }

  /** 指定模式；设置页的「跟随系统」走这里 */
  async function setMode(next: ThemeMode): Promise<void> {
    await setThemeMode(next)
  }

  return { mode, isDark, toggle, setMode }
})
