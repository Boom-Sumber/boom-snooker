import { app, BrowserWindow, ipcMain, shell } from 'electron'
import { join } from 'node:path'
import { is } from '@electron-toolkit/utils'
import { getPreferences } from './preferences'
import { currentThemeState } from './theme'
import { hasTray, isQuitting, notifyMinimizedToTray, resetTrayTooltip } from './tray'

/** 首帧底色，避免窗口出现的一瞬间闪白（暗色主题下尤其明显） */
function initialBackground(): string {
  return currentThemeState().effective === 'dark' ? '#131315' : '#eeeeee'
}

/**
 * 主窗口句柄：托盘 / 单实例都要能把它叫回来，所以提到模块级。
 * 叫 `win` 而不是 `mainWindow` —— `createMainWindow()` 里的局部变量同名，
 * 同名会把它整个遮住，模块级永远是 null（托盘就再也叫不回窗口了）。
 */
let win: BrowserWindow | null = null

/** 把窗口叫回来（隐藏或最小化都适用） */
export function showMainWindow(): void {
  if (!win || win.isDestroyed()) return
  if (win.isMinimized()) win.restore()
  if (!win.isVisible()) win.show()
  win.focus()
  resetTrayTooltip()
}

/** 当前主窗口（没有就 null）：`index.ts` 里给托盘菜单跳路由用 */
export function getMainWindow(): BrowserWindow | null {
  return win && !win.isDestroyed() ? win : null
}

export function createMainWindow(options: { hidden?: boolean } = {}): BrowserWindow {
  const mainWindow = new BrowserWindow({
    // 尺寸用逻辑像素，窗口本身可缩放（铁律 9 约束的是 CSS，不是窗口初始尺寸）
    width: 1200,
    height: 800,
    minWidth: 1024,
    minHeight: 700,
    show: false,
    frame: false,
    autoHideMenuBar: true,
    // dev 下任务栏取的是窗口图标（打包后取 exe 内嵌的 icon.ico）
    icon: join(app.getAppPath(), 'resources', 'icon.png'),
    backgroundColor: initialBackground(),
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      sandbox: false
    }
  })

  // 开机自启带 `--hidden`：窗口建好但不显示，直接留在托盘里（T10.2）
  mainWindow.on('ready-to-show', () => {
    if (options.hidden) return
    mainWindow.show()
  })

  /**
   * 关闭窗口（T10.1，D36）
   *
   * 默认不真的关，而是藏到托盘；用户在设置里选「直接退出」、或托盘菜单点「退出」
   * 时才放行。`isQuitting()` 是托盘退出 / `before-quit` 置的位 —— 没有它，
   * `app.quit()` 走到这里会被自己拦回托盘，表现为"点了退出没反应"。
   */
  mainWindow.on('close', (event) => {
    if (isQuitting()) return
    if (!hasTray() || getPreferences().closeAction === 'quit') return

    event.preventDefault()
    mainWindow.hide()
    notifyMinimizedToTray()
  })

  mainWindow.on('closed', () => {
    win = null
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

  win = mainWindow
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
