import { app, BrowserWindow } from 'electron'
import { electronApp, optimizer } from '@electron-toolkit/utils'
import { registerAppInfoIpc } from './appInfo'
import { registerAuthIpc } from './auth'
import { registerStoreIpc } from './store'
import { initTheme } from './theme'
import { createMainWindow, registerWindowIpc } from './window'

// 单实例：第二次启动不再开新窗口，直接把已有窗口叫到前面
const gotSingleInstanceLock = app.requestSingleInstanceLock()

if (!gotSingleInstanceLock) {
  app.quit()
} else {
  app.on('second-instance', () => {
    const [mainWindow] = BrowserWindow.getAllWindows()
    if (!mainWindow) return
    if (mainWindow.isMinimized()) mainWindow.restore()
    mainWindow.show()
    mainWindow.focus()
  })

  app.whenReady().then(() => {
    electronApp.setAppUserModelId('com.boom.snooker')

    // 主题必须在建窗口之前定下来，否则首帧会闪一下
    initTheme()

    registerWindowIpc()
    registerAuthIpc()
    registerAppInfoIpc()
    registerStoreIpc()

    // 开发期 F12 开关 DevTools，生产期忽略 Ctrl+R
    app.on('browser-window-created', (_, window) => {
      optimizer.watchWindowShortcuts(window)
    })

    createMainWindow()
  })

  app.on('window-all-closed', () => {
    app.quit()
  })
}
