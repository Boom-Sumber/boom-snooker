import { app } from 'electron'
import { electronApp, optimizer } from '@electron-toolkit/utils'
import { registerAppInfoIpc } from './appInfo'
import { registerAuthIpc } from './auth'
import { isHiddenLaunch, registerAutoStartIpc } from './autostart'
import { initLogging, mainLog, registerLogIpc } from './log'
import { registerMediaIpc, registerMediaProtocol } from './media'
import { initPreferences, registerPreferencesIpc } from './preferences'
import { registerStoreIpc } from './store'
import { initTheme } from './theme'
import { destroyTray, initTray, setQuitting } from './tray'
import { createMainWindow, getMainWindow, registerWindowIpc, showMainWindow } from './window'

// 日志最先起来：启动阶段（建窗口之前）出问题也要留证据
initLogging()

// 单实例：第二次启动不再开新窗口，直接把已有窗口叫到前面
const gotSingleInstanceLock = app.requestSingleInstanceLock()

if (!gotSingleInstanceLock) {
  app.quit()
} else {
  app.on('second-instance', () => {
    // 窗口可能只是藏在托盘里（T10.1），所以走统一的"叫回来"，别只看 getAllWindows
    showMainWindow()
  })

  app.whenReady().then(() => {
    electronApp.setAppUserModelId('com.boom.snooker')

    // 偏好先读：窗口的 close 行为要用到它（必须在建窗口之前）
    initPreferences()

    // 主题必须在建窗口之前定下来，否则首帧会闪一下
    initTheme()

    // 图片协议要在窗口出来之前注册好，否则首屏图片会 404
    registerMediaProtocol()

    registerWindowIpc()
    registerAuthIpc()
    registerAppInfoIpc()
    registerStoreIpc()
    registerLogIpc()
    registerPreferencesIpc()
    registerAutoStartIpc()
    registerMediaIpc()

    // 开发期 F12 开关 DevTools，生产期忽略 Ctrl+R
    app.on('browser-window-created', (_, window) => {
      optimizer.watchWindowShortcuts(window)
    })

    // 开机自启时带 `--hidden`：只建窗口不显示，程序待在托盘里
    const hidden = isHiddenLaunch()
    if (hidden) mainLog.info('后台启动（--hidden），窗口不显示')
    createMainWindow({ hidden })

    // 托盘必须在窗口建好之后：菜单里的"跳设置"要往窗口里发消息
    initTray({
      showWindow: showMainWindow,
      openSettings: () => {
        showMainWindow()
        getMainWindow()?.webContents.send('app:navigate', '/settings')
      }
    })
  })

  /**
   * 真要退出时置位 —— 否则 `app.quit()` 触发的 close 会被自己拦回托盘，
   * 表现为"点了退出没反应"（T10.1 最容易踩的坑）
   */
  app.on('before-quit', () => {
    setQuitting(true)
  })

  app.on('will-quit', () => {
    destroyTray()
  })

  /**
   * 窗口全关了怎么办：
   *   - 默认（最小化到托盘）：窗口是**隐藏**不是关闭，这个事件根本不会触发，
   *     留着只是为了兜住"托盘没起来"的降级路径
   *   - 用户选了「直接退出」：这里必须 quit，否则进程会挂着不走
   */
  app.on('window-all-closed', () => {
    app.quit()
  })
}
