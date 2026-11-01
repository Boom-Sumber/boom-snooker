import { app, ipcMain } from 'electron'

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
}
