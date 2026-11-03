/**
 * 日志接口（主进程写入，渲染进程只能通过 IPC 提交）
 *
 * 渲染进程没有文件系统权限，也不该有 —— 所有日志最终都落到主进程的
 * `electron-log` 文件里，这样排查问题时**只有一个地方要看**。
 */
export type LogLevel = 'debug' | 'info' | 'warn' | 'error'

export interface LogApi {
  /** 记一条日志；`detail` 已由调用方序列化成字符串（IPC 传不了 Error 实例） */
  write: (level: LogLevel, scope: string, message: string, detail?: string) => void
  /** 日志文件绝对路径（设置页展示 / 排查时复制） */
  path: () => Promise<string>
  /** 在资源管理器里定位到日志文件（文件还没生成时打开所在目录） */
  open: () => Promise<void>
}
