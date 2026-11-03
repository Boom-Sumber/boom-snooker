/**
 * 日志（T6.2）
 *
 * 目标只有两条：**异常不崩** + **出事有地方查**。
 *
 * 落盘位置：`%APPDATA%\<应用名>\logs\main.log`（electron-log 默认用 `app.getPath('logs')`）。
 * 超过 5 MB 自动轮转成 `main.old.log`，不会无限长 —— 免费盘、用户机器，都不能留隐患。
 *
 * 为什么自己写 `uncaughtException` 而不是用 electron-log 的 `errorHandler`：
 * 那个会弹对话框并建议重启，而本项目的定位是"内部教学工具，别因为一条渲染异常就把人踢出去"。
 * 我们只记日志、让应用继续跑；用户能看到的错误提示由渲染层自己弹（见 `services/error-handler.ts`）。
 */
import { app, ipcMain, shell } from 'electron'
import log from 'electron-log/main'
import { is } from '@electron-toolkit/utils'
import type { LogLevel } from '@shared/types/log'

/** 主进程自己的日志：带 `(main)` 作用域，和渲染层上报的 `(renderer:xxx)` 区分开 */
export const mainLog = log.scope('main')

/** 单个日志文件上限，超过就轮转（electron-log 会改名成 main.old.log） */
const FILE_MAX_SIZE = 5 * 1024 * 1024

/** 渲染进程允许上报的级别白名单 —— 不让 IPC 参数直接当方法名用 */
const ALLOWED_LEVELS: readonly LogLevel[] = ['debug', 'info', 'warn', 'error']

/** 当前日志文件路径（设置页展示、`log:path` 都走这里） */
export function logFilePath(): string {
  return log.transports.file.getFile().path
}

/**
 * 初始化日志（**必须尽早调用**，在 `app.whenReady()` 之前）
 *
 * 早于建窗口，才能把"启动阶段就失败"的情况也记下来。
 */
export function initLogging(): void {
  log.transports.file.level = is.dev ? 'debug' : 'info'
  log.transports.file.maxSize = FILE_MAX_SIZE
  // {scope} 紧跟在级别后面：主进程写 `[main]`，渲染层写 `[renderer:xxx]`
  log.transports.file.format = '[{y}-{m}-{d} {h}:{i}:{s}.{ms}] [{level}]{scope} {text}'
  log.transports.console.level = is.dev ? 'debug' : 'warn'
  log.transports.console.format = '[{h}:{i}:{s}] [{level}]{scope} {text}'

  // 关掉作用域名称的自动补白：`main` / `renderer:resource` 长度不同，
  // 补白会让同一天日志里正文的起始列来回跳，反而难读
  ;(log.scope as unknown as { labelPadding: boolean }).labelPadding = false

  // ── 进程级异常兜底 ──
  // 注意：这里**不退出进程**。主进程的未知异常继续跑有风险，但直接崩掉用户更难受；
  // 日志里有完整堆栈，出问题后能定位，必要时再人工重启。
  process.on('uncaughtException', (error) => {
    mainLog.error('uncaughtException', error)
  })
  process.on('unhandledRejection', (reason) => {
    mainLog.error('unhandledRejection', reason)
  })

  // 渲染进程崩溃 / 子进程异常：窗口会白屏，必须留证据
  app.on('render-process-gone', (_event, _contents, details) => {
    mainLog.error('render-process-gone', details)
  })
  app.on('child-process-gone', (_event, details) => {
    mainLog.error('child-process-gone', details)
  })

  // 正常退出也记一条：日志末尾没有这行 = 上次是被杀掉的（任务管理器 / 断电）
  app.on('will-quit', () => {
    mainLog.info('退出')
  })

  // 页面加载失败（dev server 没起、生产包文件缺失）：白屏时最有用的一条
  app.on('web-contents-created', (_event, contents) => {
    contents.on('did-fail-load', (_e, code, description, url, isMainFrame) => {
      if (!isMainFrame) return
      mainLog.error(`页面加载失败 code=${code} desc=${description} url=${url}`)
    })
    contents.on('unresponsive', () => {
      mainLog.warn('渲染进程无响应')
    })
  })

  mainLog.info(
    `启动 v${app.getVersion()} · electron ${process.versions.electron} · ` +
      `chrome ${process.versions.chrome} · ${process.platform}/${process.arch} · ` +
      `dev=${is.dev}`
  )
  mainLog.info(`日志文件：${logFilePath()}`)
}

/** 注册日志相关 IPC（`app.whenReady()` 之后调用） */
export function registerLogIpc(): void {
  // 渲染层上报：fire-and-forget（`send`），不等回执，避免日志拖慢业务
  ipcMain.on(
    'log:write',
    (_event, level: LogLevel, scope: string, message: string, detail?: string) => {
      const safeLevel = ALLOWED_LEVELS.includes(level) ? level : 'info'
      const line = detail ? `${message} ${detail}` : message
      log.scope(`renderer:${scope || 'unknown'}`)[safeLevel](line)
    }
  )

  ipcMain.handle('log:path', () => logFilePath())

  ipcMain.handle('log:open', () => {
    // 文件存在就选中它，不存在就打开目录（首次启动、还没写过日志时）
    shell.showItemInFolder(logFilePath())
  })
}
