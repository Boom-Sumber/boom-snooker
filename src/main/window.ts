import { BrowserWindow, ipcMain, shell } from 'electron'
import { join } from 'node:path'
import { is } from '@electron-toolkit/utils'
import { currentThemeState } from './theme'

/** 首帧底色，避免窗口出现的一瞬间闪白（暗色主题下尤其明显） */
function initialBackground(): string {
  return currentThemeState().effective === 'dark' ? '#131315' : '#eeeeee'
}

export function createMainWindow(): BrowserWindow {
  const mainWindow = new BrowserWindow({
    // 尺寸用逻辑像素，窗口本身可缩放（铁律 9 约束的是 CSS，不是窗口初始尺寸）
    width: 1200,
    height: 800,
    minWidth: 1024,
    minHeight: 700,
    show: false,
    frame: false,
    autoHideMenuBar: true,
    backgroundColor: initialBackground(),
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      sandbox: false
    }
  })

  mainWindow.on('ready-to-show', () => {
    mainWindow.show()
  })

  // 外部链接一律交给系统浏览器，不在应用内打开
  mainWindow.webContents.setWindowOpenHandler((details) => {
    shell.openExternal(details.url)
    return { action: 'deny' }
  })

  // 最大化状态变化要推给渲染进程，否则标题栏的「最大化 / 还原」图标不会变
  const notifyMaximize = (): void => {
    if (mainWindow.isDestroyed()) return
    mainWindow.webContents.send('window:maximize-changed', mainWindow.isMaximized())
  }
  mainWindow.on('maximize', notifyMaximize)
  mainWindow.on('unmaximize', notifyMaximize)
  mainWindow.on('enter-full-screen', notifyMaximize)
  mainWindow.on('leave-full-screen', notifyMaximize)

  // 开发期走 HMR 地址，生产期读打包后的 html
  if (is.dev && process.env['ELECTRON_RENDERER_URL']) {
    mainWindow.loadURL(process.env['ELECTRON_RENDERER_URL'])
  } else {
    mainWindow.loadFile(join(__dirname, '../renderer/index.html'))
  }

  return mainWindow
}

/**
 * 窗口控制 IPC。用 event.sender 反查窗口，而不是闭包捕获，
 * 以后多窗口也不会串。
 */
export function registerWindowIpc(): void {
  const from = (event: Electron.IpcMainEvent | Electron.IpcMainInvokeEvent): BrowserWindow | null =>
    BrowserWindow.fromWebContents(event.sender)

  ipcMain.on('window:minimize', (event) => {
    from(event)?.minimize()
  })

  ipcMain.on('window:toggle-maximize', (event) => {
    const win = from(event)
    if (!win) return
    if (win.isMaximized()) {
      win.unmaximize()
    } else {
      win.maximize()
    }
  })

  ipcMain.on('window:close', (event) => {
    from(event)?.close()
  })

  ipcMain.handle('window:is-maximized', (event): boolean => from(event)?.isMaximized() ?? false)
}
