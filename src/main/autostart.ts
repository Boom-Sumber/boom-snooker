/**
 * 开机自启动（T10.2，D36）
 *
 * 三个决定：
 *   1. **只在安装版生效**：dev 模式下 `app.setLoginItemSettings` 写进注册表的是
 *      `electron.exe` 的路径，卸载或换目录后会留下一条指向空路径的启动项，
 *      属于"自己给自己埋雷"。所以 dev 下只记偏好、不碰系统。
 *   2. **开关状态以系统为准**：用户可能在任务管理器里手动禁用了开机启动，
 *      自己的 json 还写着 true —— 界面就会显示一个假状态。所以读的时候读系统，
 *      `preferences.openAtLogin` 只当镜像（dev 下的回退）。
 *   3. **读的时候必须带上写入时的参数**（2026-11-04 修）：Windows 上
 *      `getLoginItemSettings()` 是拿「exe 路径 + args」去比对注册表值的，
 *      args 默认是空数组。我们写入时带了 `--hidden`，读取时不传 args 就永远
 *      比不中 → 安装版打开开关立刻弹回并提示"系统没有接受这个设置"。
 *      注册表里其实早就写进去了（`HKCU\...\Run` 的 `com.boom.snooker`）。
 */
import { app, ipcMain } from 'electron'
import { mainLog } from './log'
import { getPreferences, updatePreferences } from './preferences'
import type { AutoStartState } from '@shared/types/system'

/** 自启时带的参数：启动时直接进托盘，不弹主窗口 */
export const HIDDEN_ARG = '--hidden'

/** 只有安装包（已打包）才允许写系统启动项 */
export function isAutoStartSupported(): boolean {
  return app.isPackaged
}

/**
 * 读系统里的真实状态
 *
 * 先按「带 `--hidden`」比对（这是我们现在写的形式），再退回「不带参数」——
 * 早期手动加进启动项的、或被用户在系统工具里改过形态的条目，也算开启。
 */
function readOpenAtLogin(): boolean {
  const execPath = process.execPath
  if (app.getLoginItemSettings({ path: execPath, args: [HIDDEN_ARG] }).openAtLogin) return true
  return app.getLoginItemSettings({ path: execPath, args: [] }).openAtLogin
}

export function getAutoStartState(): AutoStartState {
  const supported = isAutoStartSupported()
  const enabled = supported ? readOpenAtLogin() : getPreferences().openAtLogin
  return { enabled, supported }
}

export function setAutoStart(enabled: boolean): AutoStartState {
  // 镜像一份：dev 下界面也有状态，打包后重装还能"记得上次的选择"
  updatePreferences({ openAtLogin: enabled })

  if (!isAutoStartSupported()) {
    mainLog.info('autostart', `dev 模式不写注册表（enabled=${enabled}）`)
    return { enabled, supported: false }
  }

  // `openAsHidden` 只有 macOS 有（Windows 上类型里根本没有），
  // 跨平台统一的做法是带 `--hidden` 参数：启动时自己判断要不要显示窗口
  app.setLoginItemSettings({
    openAtLogin: enabled,
    path: process.execPath,
    args: [HIDDEN_ARG]
  })

  const actual = readOpenAtLogin()
  if (actual !== enabled) {
    mainLog.warn('autostart', '系统没有接受这个设置', { want: enabled, got: actual })
  }
  return { enabled: actual, supported: true }
}

/** 是否以"后台启动"的方式起来的（开机自启带的 `--hidden`） */
export function isHiddenLaunch(): boolean {
  return process.argv.includes(HIDDEN_ARG)
}

export function registerAutoStartIpc(): void {
  ipcMain.handle('autostart:get', (): AutoStartState => getAutoStartState())

  ipcMain.handle('autostart:set', (_event, enabled: boolean): AutoStartState =>
    setAutoStart(enabled === true)
  )
}
