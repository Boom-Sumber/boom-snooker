/**
 * 渲染层日志（T6.2）
 *
 * 渲染进程没有文件权限，所有日志经 `window.api.log` 走 IPC 交给主进程的
 * `electron-log` 落盘 —— 排障时**只看一个文件**（设置页能直接打开它）。
 *
 * 两条原则：
 *   1. **日志失败绝不能影响业务**：preload 没就绪、主进程已退出都可能让 `write` 抛错，
 *      这里全部吞掉（连 `window.api` 是否存在都判了）
 *   2. **只记有诊断价值的东西**：不记点击流水，记异常、失败、关键状态迁移
 */
import type { LogLevel } from '@shared/types/log'

/**
 * 把任意 detail 摊平成字符串
 *
 * IPC 的结构化克隆传不了 Error 实例（`message`/`stack` 会丢），
 * 所以在渲染层就序列化好，主进程只管写。
 */
function formatDetail(detail: unknown): string | undefined {
  if (detail === undefined || detail === null || detail === '') return undefined
  if (typeof detail === 'string') return detail
  if (detail instanceof Error) {
    return `${detail.name}: ${detail.message}${detail.stack ? `\n${detail.stack}` : ''}`
  }
  if (typeof detail === 'object') {
    try {
      return JSON.stringify(detail)
    } catch {
      // 循环引用 / BigInt 之类，退化成 String()
      return String(detail)
    }
  }
  return String(detail)
}

function write(level: LogLevel, scope: string, message: string, detail?: unknown): void {
  const text = formatDetail(detail)
  try {
    window.api?.log?.write(level, scope, message, text)
  } catch {
    // 有意吞掉：日志系统本身出错不该把业务带崩
  }

  // 开发期同时打到 DevTools 控制台，省得来回翻文件
  if (import.meta.env.DEV) {
    const prefix = `[${scope}] ${message}`
    if (level === 'error') console.error(prefix, detail ?? '')
    else if (level === 'warn') console.warn(prefix, detail ?? '')
    else if (level === 'debug') console.debug(prefix, detail ?? '')
    else console.info(prefix, detail ?? '')
  }
}

export const logger = {
  debug(scope: string, message: string, detail?: unknown): void {
    write('debug', scope, message, detail)
  },
  info(scope: string, message: string, detail?: unknown): void {
    write('info', scope, message, detail)
  },
  warn(scope: string, message: string, detail?: unknown): void {
    write('warn', scope, message, detail)
  },
  error(scope: string, message: string, detail?: unknown): void {
    write('error', scope, message, detail)
  }
}
