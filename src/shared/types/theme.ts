/**
 * 主题模式（主进程 / 预加载 / 渲染进程共用）
 *
 * - system: 跟随系统（默认）
 * - light / dark: 强制指定
 */
export type ThemeMode = 'system' | 'light' | 'dark'

export const THEME_MODES = ['system', 'light', 'dark'] as const

export const DEFAULT_THEME_MODE: ThemeMode = 'system'

export function isThemeMode(value: unknown): value is ThemeMode {
  return typeof value === 'string' && (THEME_MODES as readonly string[]).includes(value)
}

/** 主进程与渲染进程之间传递的主题状态 */
export interface ThemeState {
  /** 用户选择的模式 */
  mode: ThemeMode
  /** 实际生效的外观（system 时由系统决定） */
  effective: 'light' | 'dark'
}

/** 预加载脚本暴露给渲染进程的主题 API（window.api.theme） */
export interface ThemeApi {
  get(): Promise<ThemeState>
  set(mode: ThemeMode): Promise<ThemeState>
}
