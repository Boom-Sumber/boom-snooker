/**
 * 开机自启动（T10.2，D36）
 *
 * 两个决定：
 *   1. **只在安装版生效**：dev 模式下 `app.setLoginItemSettings` 写进注册表的是
 *      `electron.exe` 的路径，卸载或换目录后会留下一条指向空路径的启动项，
 *      属于"自己给自己埋雷"。所以 dev 下只记偏好、不碰系统。
 *   2. **开关状态以系统为准**：用户可能在任务管理器里手动禁用了开机启动，
 *      自己的 json 还写着 true —— 界面就会显示一个假状态。所以读的时候读系统，
 *      `preferences.openAtLogin` 只当镜像（dev 下的回退）。
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

export function getAutoStartState(): AutoStartState {
  const supported = isAutoStartSupported()
  const enabled = supported ? app.getLoginItemSettings().openAtLogin : getPreferences().openAtLogin
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
    args: [HIDDEN_ARG]
  })

  const actual = app.getLoginItemSettings().openAtLogin
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
