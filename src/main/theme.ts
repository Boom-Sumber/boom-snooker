import { app, ipcMain, nativeTheme } from 'electron'
import { mkdirSync, readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import {
  DEFAULT_THEME_MODE,
  isThemeMode,
  type ThemeMode,
  type ThemeState
} from '@shared/types/theme'

/**
 * 主题设置持久化：`<userData>/theme.json`
 *
 * 为什么不用 localStorage：
 *   - 主进程创建窗口**之前**就要知道用哪套主题（nativeTheme.themeSource），
 *     localStorage 只有渲染进程能读，读到的时候窗口已经画完，必然闪一下
 *   - 铁律 10：本地文件一律「写临时文件 → 原子 rename」，中断不会留下半截文件
 */
const FILE_NAME = 'theme.json'

let currentMode: ThemeMode = DEFAULT_THEME_MODE

function settingsFile(): string {
  return join(app.getPath('userData'), FILE_NAME)
}

function loadMode(): ThemeMode {
  try {
    const parsed = JSON.parse(readFileSync(settingsFile(), 'utf8')) as { mode?: unknown }
    return isThemeMode(parsed.mode) ? parsed.mode : DEFAULT_THEME_MODE
  } catch {
    // 首次启动没有文件，或内容被改坏 —— 都回落到默认值，不抛
    return DEFAULT_THEME_MODE
  }
}

function saveMode(mode: ThemeMode): void {
  const target = settingsFile()
  const tmp = `${target}.tmp`
  try {
    mkdirSync(dirname(target), { recursive: true })
    writeFileSync(tmp, JSON.stringify({ mode }, null, 2), 'utf8')
    renameSync(tmp, target)
  } catch (error) {
    console.error('[theme] 保存主题设置失败：', error)
    rmSync(tmp, { force: true })
  }
}

export function currentThemeState(): ThemeState {
  return { mode: currentMode, effective: nativeTheme.shouldUseDarkColors ? 'dark' : 'light' }
}

/** 必须在创建窗口之前调用 */
export function initTheme(): ThemeState {
  currentMode = loadMode()
  // 先定 nativeTheme，窗口首帧的 prefers-color-scheme 就是对的，不闪
  nativeTheme.themeSource = currentMode

  ipcMain.handle('theme:get', (): ThemeState => currentThemeState())

  ipcMain.handle('theme:set', (_event, mode: unknown): ThemeState => {
    if (!isThemeMode(mode)) {
      // 非法值静默忽略，保持当前设置（宁可不变，也不要因为一次误传把界面搞崩）
      return currentThemeState()
    }
    currentMode = mode
    nativeTheme.themeSource = mode
    saveMode(mode)
    return currentThemeState()
  })

  return currentThemeState()
}
