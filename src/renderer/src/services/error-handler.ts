/**
 * 全局异常兜底（T6.2）
 *
 * 三处入口，缺一个就会"白屏但日志里什么都没有"：
 *   1. `app.config.errorHandler` —— Vue 组件生命周期 / 渲染 / 事件里的异常
 *   2. `window 'error'` —— 组件树之外的脚本错误、资源加载失败
 *   3. `window 'unhandledrejection'` —— 没 catch 的 Promise（本项目大量用 async，
 *      这个入口最容易被忽略，也最容易在断网时触发）
 *
 * 策略：**记录 + 提示，但不卸载界面**。用户能继续点别的，日志里有完整堆栈。
 * 提示做了限流 —— 一个渲染异常可能连续抛好几次，不拦就会刷出一屏红条。
 */
import type { App } from 'vue'
import { ElMessage } from 'element-plus'
import { logger } from './logger'

/** 两条提示之间的最小间隔（ms） */
const TOAST_INTERVAL = 3000
let lastToastAt = 0

function toastOnce(message: string): void {
  const now = Date.now()
  if (now - lastToastAt < TOAST_INTERVAL) return
  lastToastAt = now
  ElMessage.error({ message, duration: 4000, grouping: true })
}

export function installErrorHandlers(app: App): void {
  // ① Vue 内部异常：`info` 会告诉你出在渲染、watcher 还是事件回调
  app.config.errorHandler = (error, _instance, info) => {
    logger.error('vue', `组件异常（${info}）`, error)
    toastOnce('页面出了点问题，已记录日志')
  }

  // ② 组件树之外：语法错误、第三方脚本、图片/字体加载失败
  // 必须用**捕获阶段**：资源加载失败（img/script/link）的 error 事件不冒泡，
  // 冒泡阶段挂在 window 上永远收不到 —— 这是最常见的一个漏抓点。
  window.addEventListener(
    'error',
    (event) => {
      const target = event.target
      // 资源加载失败走的是同一事件，但 message 是空的、target 是元素
      if (target instanceof HTMLElement && !event.message) {
        const src =
          target.getAttribute('src') ?? target.getAttribute('href') ?? target.tagName.toLowerCase()
        logger.warn('resource', '资源加载失败', src)
        return
      }

      logger.error('window', event.message || '未捕获异常', {
        source: event.filename,
        line: event.lineno,
        column: event.colno,
        stack: event.error instanceof Error ? event.error.stack : undefined
      })
    },
    true
  )

  // ③ 未处理的 Promise 拒绝：断网、RPC 抛错没 catch 时都从这里冒出来
  window.addEventListener('unhandledrejection', (event) => {
    logger.error('window', '未处理的 Promise 拒绝', event.reason)
  })

  logger.info('app', `渲染进程启动 ${location.hash || '#/'}`)
}
