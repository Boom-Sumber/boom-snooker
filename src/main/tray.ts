/**
 * 系统托盘（T10.1，D36）
 *
 * 为什么需要：教学工具是"随时查一眼"的用法，关一次窗口就退出太打断；
 * 但也不能强制所有人接受常驻后台，所以"关了怎么办"做成设置项（`preferences.ts`）。
 *
 * 两个容易写错的地方：
 *   1. **退出要走 `requestQuit()`**：直接 `app.quit()` 会被窗口的 `close` 拦截吃回托盘，
 *      表现为"点了退出没反应"。`before-quit` 里也会置位，双保险。
 *   2. **图标路径要兼容 dev 与打包**：`build/` 是 electron-builder 的打包资源目录，
 *      打完包后 app 里没有它；能用的是 `resources/`（见 electron-builder.yml 的 asarUnpack）。
 */
import { Menu, Tray } from 'electron'
import { app } from 'electron'
import { existsSync } from 'node:fs'
import { join } from 'node:path'
import { mainLog } from './log'
import { getPreferences, updatePreferences } from './preferences'

/** 托盘菜单点击后的动作，由 `index.ts` 注入（避免 tray ↔ window 循环依赖） */
export interface TrayHandlers {
  showWindow: () => void
  openSettings: () => void
}

let tray: Tray | null = null
let quitting = false

/** 是否正在真退出（此时窗口的 close 不再拦） */
export function isQuitting(): boolean {
  return quitting
}

export function setQuitting(value: boolean): void {
  quitting = value
}

/** 托盘「退出」/ 菜单退出都走这里：先置位再 quit，否则会被 close 拦截吞掉 */
export function requestQuit(): void {
  setQuitting(true)
  app.quit()
}

/**
 * 托盘图标路径
 *
 * 顺序：`resources/tray.png`（32×32 专用小图）→ `resources/icon.png`（256）→ `build/`（dev 兜底）。
 * 为什么托盘要单独一张：1024/256 缩到 16px 会把 15 颗球糊成一团红，托盘图必须是小尺寸可辨认的版本
 * （`scripts/make-icons.js` 生成）。打包后 `resources/` 在 asarUnpack 里，dev 下就是源码目录。
 */
function trayIconPath(): string | null {
  const candidates = [
    join(app.getAppPath(), 'resources', 'tray.png'),
    join(app.getAppPath(), 'resources', 'icon.png'),
    join(app.getAppPath(), 'build', 'icon.png')
  ]
  return candidates.find((file) => existsSync(file)) ?? null
}

export function initTray(handlers: TrayHandlers): void {
  const icon = trayIconPath()
  if (!icon) {
    mainLog.error('tray', '找不到托盘图标，托盘未启用')
    return
  }

  tray = new Tray(icon)
  tray.setToolTip('斯诺克走位教学')

  const menu = Menu.buildFromTemplate([
    {
      label: '显示主界面',
      click: () => handlers.showWindow()
    },
    {
      label: '打开设置',
      click: () => handlers.openSettings()
    },
    { type: 'separator' },
    {
      label: '退出',
      click: () => requestQuit()
    }
  ])
  tray.setContextMenu(menu)

  // Windows 上单击（左键）直接叫回窗口 —— 只有右键才弹菜单
  tray.on('click', () => handlers.showWindow())

  mainLog.info('tray', `托盘已就绪 ${icon}`)
}

/**
 * 首次最小化到托盘时提示一次
 *
 * Windows 10+ 的气泡可能被系统静音 / 折叠进通知中心，所以托盘标题栏上也会
 * 短暂改一次文案，至少有个"不是卡住了"的反馈。
 */
export function notifyMinimizedToTray(): void {
  if (!tray) return
  if (!getPreferences().trayHintShown) {
    updatePreferences({ trayHintShown: true })
    tray.displayBalloon({
      iconType: 'info',
      title: '已最小化到托盘',
      content: '程序还在后台运行，点托盘图标就能叫回来；想直接退出请在托盘菜单里选「退出」。'
    })
  }
  tray.setToolTip('斯诺克走位教学（后台运行中）')
}

/** 窗口重新显示时把提示文案改回去 */
export function resetTrayTooltip(): void {
  tray?.setToolTip('斯诺克走位教学')
}

/** 窗口销毁时清掉托盘，否则进程退出后图标还会残留在通知区 */
export function destroyTray(): void {
  if (!tray) return
  tray.destroy()
  tray = null
}

/** 供 `window.ts` 判断：托盘是否可用（没有图标时降级为"关闭即退出"） */
export function hasTray(): boolean {
  return tray !== null
}
