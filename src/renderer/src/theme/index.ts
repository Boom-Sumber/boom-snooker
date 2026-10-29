import { readonly, ref } from 'vue'
import { DEFAULT_THEME_MODE, type ThemeMode } from '@shared/types/theme'

/**
 * 主题状态（渲染进程侧）
 *
 * 单一数据流：
 *   点击切换 → 乐观更新 class → IPC 让主进程改 nativeTheme.themeSource
 *   → Chromium 更新 prefers-color-scheme → 本模块的 media 监听重新上色
 *
 * 好处：无论「用户点的」还是「系统变了」，最终都走同一条上色路径，不会出现
 * 主进程与页面外观不一致的中间态。
 */

const mode = ref<ThemeMode>(DEFAULT_THEME_MODE)
const isDark = ref(false)

const media = window.matchMedia('(prefers-color-scheme: dark)')

function paint(): void {
  const dark = mode.value === 'dark' || (mode.value === 'system' && media.matches)
  isDark.value = dark
  document.documentElement.classList.toggle('dark', dark)
}

/**
 * 在 createApp 之前调用：首帧就按系统外观上色，避免闪一下再变。
 * 此时主进程已经按持久化设置改过 nativeTheme，所以 media.matches 就是最终答案。
 */
export function initTheme(): void {
  paint()
  media.addEventListener('change', paint)

  // 把「用户选的是哪一档」同步回来（只影响 UI 上的选中态）
  void window.api.theme
    .get()
    .then((state) => {
      mode.value = state.mode
      paint()
    })
    .catch((error) => {
      console.error('[theme] 读取主题设置失败，按系统外观显示：', error)
    })
}

export async function setThemeMode(next: ThemeMode): Promise<void> {
  const previous = mode.value
  mode.value = next
  paint()

  try {
    const state = await window.api.theme.set(next)
    mode.value = state.mode
    paint()
  } catch (error) {
    mode.value = previous
    paint()
    throw error
  }
}

export const themeMode = readonly(mode)
export const themeIsDark = readonly(isDark)
