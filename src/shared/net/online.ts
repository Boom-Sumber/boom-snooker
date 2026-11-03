/**
 * 网络错误判定（唯一来源）
 *
 * 为什么单独一层：
 *   - 8 个 api 模块原本各写一遍 `Failed to fetch || fetch failed`，
 *     判定范围已经开始漂移（有的认 TypeError、有的只认两条字符串）
 *   - 同步层（`sync/snapshot.ts`）与写操作层（`api/*`）必须用同一套判定，
 *     否则会出现"同步说离线、保存说未知错误"的割裂
 *
 * 这里**只做判定**，不持有状态。渲染层的在线状态在
 * `renderer/stores/network.ts` —— `navigator` / `online` 事件属于 UI 环境，
 * 放进 shared 会让主进程侧的代码也被迫依赖 DOM。
 */

/** 网络类错误的统一文案（同步失败、写操作失败都用这句） */
export const NETWORK_ERROR_TEXT = '连不上服务器，检查一下网络'

/** 离线时点写操作的说明（提示条与按钮 tooltip 共用同一句） */
export const OFFLINE_WRITE_HINT = '离线状态下无法保存，请先恢复网络'

/**
 * 各运行时的"连不上"文案
 *
 * - Chromium / Electron 渲染进程：`TypeError: Failed to fetch`
 * - undici（Node 侧）：`fetch failed`
 * - 主进程 net 模块：`net::ERR_INTERNET_DISCONNECTED` / `ERR_NAME_NOT_RESOLVED`
 * - supabase-js 包装后的 AbortSignal：`AbortError` / `TimeoutError`（走 name 判定）
 */
const NETWORK_TEXT_PATTERNS = [
  'failed to fetch',
  'fetch failed',
  'networkerror',
  'network error',
  'load failed',
  'err_internet_disconnected',
  'err_network',
  'err_name_not_resolved',
  'err_connection'
]

function matchesNetworkText(text: string): boolean {
  const lower = text.toLowerCase()
  return NETWORK_TEXT_PATTERNS.some((pattern) => lower.includes(pattern))
}

/**
 * 判断一个错误是不是"网络层失败"
 *
 * 传字符串时按文案匹配（各 `translate*Error` 只拿得到 `error.message`）。
 * **注意不要拿裸 `TypeError` 当网络错误**：那会把代码 bug 伪装成"连不上服务器"，
 * 真正断网时 fetch 抛的 TypeError 文案是 `Failed to fetch`，下面能命中。
 */
export function isNetworkError(error: unknown): boolean {
  if (error === null || error === undefined) return false
  if (typeof error === 'string') return matchesNetworkText(error)
  if (typeof error !== 'object') return false

  const { name, message } = error as { name?: unknown; message?: unknown }
  if (name === 'AbortError' || name === 'TimeoutError') return true
  return typeof message === 'string' && matchesNetworkText(message)
}

/**
 * 渲染进程视角的"有没有网"
 *
 * 只反映网卡状态：连着路由器但出口不通时它仍然是 true，
 * 所以真正的离线判定要再叠加一次"服务端有没有响应"（见 network store）。
 */
export function isBrowserOnline(): boolean {
  if (typeof navigator === 'undefined') return true
  return navigator.onLine !== false
}
