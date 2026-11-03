import { app, ipcMain } from 'electron'
import { requestQuit } from './tray'

/**
 * 应用信息 IPC（T3.7 设置页的「版本与关于」用）
 *
 * 渲染进程拿不到 `app.getVersion()`，必须由主进程提供；
 * 顺手把 Electron / Chromium / Node 版本一起给出来，排查问题时能直接看。
 */
export function registerAppInfoIpc(): void {
  ipcMain.handle('app:info', () => ({
    version: app.getVersion(),
    electron: process.versions.electron,
    chrome: process.versions.chrome,
    node: process.versions.node,
    platform: process.platform
  }))

  /**
   * 退出程序（U3 强制更新弹窗的「退出程序」按钮）
   *
   * 必须走 `requestQuit()` 而不是直接 `app.quit()`：关闭行为设成"最小化到托盘"时，
   * 窗口的 close 会被拦下来，直接 quit 的表现就是"点了退出没反应"。
   */
  ipcMain.handle('app:quit', (): void => requestQuit())
}
