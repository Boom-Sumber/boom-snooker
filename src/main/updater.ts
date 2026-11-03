/**
 * 应用内更新（U2）
 *
 * 三层职责分清楚，别混：
 *   - **electron-updater** 只管两件事：读清单判断有没有新版、把安装包下下来
 *   - **本文件** 是唯一状态机：把事件收敛成 `UpdateState`，再把快照推给渲染层和托盘
 *   - **渲染层** 只渲染，不自己算"是不是有新版本"
 *
 * 三条不可回退的设定（`docs/10` 第 4 节，改之前先想清楚代价）：
 *   1. `autoDownload = false` —— 124 MB 的包不能偷偷下，流量在这是稀缺资源
 *   2. `allowDowngrade = false` —— 不做降级，回滚 = 发一个更高版本号的修复版
 *   3. `autoInstallOnAppQuit = true` —— 用户点「稍后」后，下次退出时自动装，
 *      否则"下载完忘了点重启"会让更新永远停在半路
 *
 * 强制更新（`mandatory`）不来自 electron-updater：清单只描述"有什么版本"，
 * 策略放在同目录的 `policy.json`（发布脚本一起上传）。拿不到策略一律按非强制处理 ——
 * 不能因为一个几百字节的文件拉不到，就把所有人锁在旧版里出不去。
 */
import { app, BrowserWindow, ipcMain } from 'electron'
import { autoUpdater, type AppUpdater } from 'electron-updater'
import { CancellationToken, type ProgressInfo, type UpdateInfo } from 'builder-util-runtime'
import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import log from 'electron-log/main'
import type { UpdateInfoLite, UpdateState } from '@shared/types/update'
import { mainLog } from './log'
import { setQuitting, setUpdateAvailable } from './tray'

/** 启动后多久做第一次检查：太早会和首屏抢带宽，太晚用户已经关了设置页 */
const STARTUP_DELAY = 8_000

/** 自动检查间隔（6 小时） */
const CHECK_INTERVAL = 6 * 60 * 60 * 1000

/** 拉 policy.json 的超时：它只有几百字节，5 秒拿不到就当没有 */
const POLICY_TIMEOUT = 5_000

const updater: AppUpdater = autoUpdater

let feedUrl: string | null = null
let supported = false
let unsupportedReason: string | null = null
let cancelToken: CancellationToken | null = null
let checkTimer: NodeJS.Timeout | null = null
let checkInterval: NodeJS.Timeout | null = null

const state: UpdateState = {
  phase: 'idle',
  currentVersion: app.getVersion(),
  info: null,
  progress: null,
  mandatory: false,
  minSupportedVersion: null,
  error: null,
  checkedAt: null,
  unsupportedReason: null
}

// ────────────────────────────── 版本比较 ──────────────────────────────

/** `1.2.3` / `v1.2.3` / `1.2.3-beta.1` → `[1,2,3]`（只取前三段数字，够用且不引依赖） */
function versionParts(version: string): number[] {
  return version
    .replace(/^v/i, '')
    .split('.')
    .slice(0, 3)
    .map((part) => Number.parseInt(part, 10) || 0)
}

/** <0 表示 a 更低，0 相等，>0 更高 */
function compareVersion(a: string, b: string): number {
  const left = versionParts(a)
  const right = versionParts(b)
  for (let i = 0; i < 3; i += 1) {
    const diff = (left[i] ?? 0) - (right[i] ?? 0)
    if (diff !== 0) return diff
  }
  return 0
}

// ────────────────────────────── 状态广播 ──────────────────────────────

function snapshot(): UpdateState {
  return {
    ...state,
    info: state.info ? { ...state.info } : null,
    progress: state.progress ? { ...state.progress } : null
  }
}

/** 推给所有窗口 + 托盘。没有窗口时也不报错（开机自启藏在托盘里就是这个场景） */
function broadcast(): void {
  const snap = snapshot()
  for (const win of BrowserWindow.getAllWindows()) {
    if (!win.isDestroyed()) win.webContents.send('updater:state', snap)
  }
  // 非强制更新不弹窗打扰，托盘 tooltip 是唯一的常驻提示
  const notify =
    snap.phase === 'available' || snap.phase === 'downloading' || snap.phase === 'downloaded'
  setUpdateAvailable(notify ? (snap.info?.version ?? null) : null)
}

function toLite(info: UpdateInfo): UpdateInfoLite {
  return {
    version: info.version,
    releaseDate: info.releaseDate ?? null,
    notes: typeof info.releaseNotes === 'string' ? info.releaseNotes : null,
    size: info.files?.[0]?.size ?? null
  }
}

// ────────────────────────────── 环境探测 ──────────────────────────────

/**
 * 判断当前环境能不能更新。
 *
 * dev 下 electron-updater 会去读 `app-update.yml`，读不到直接抛错 —— 所以必须挡在门外，
 * 而不是 try/catch 兜住了事（否则每次启动都在日志里刷一条无意义的报错）。
 */
function detectSupport(): void {
  if (!app.isPackaged) {
    supported = false
    unsupportedReason = '开发模式不检查更新，需安装版才能验证'
    return
  }

  const configPath = join(process.resourcesPath, 'app-update.yml')
  if (!existsSync(configPath)) {
    supported = false
    unsupportedReason = '缺少 app-update.yml，当前不是 electron-builder 打出的安装版'
    return
  }

  try {
    // 只取 feed 地址：其余字段（provider / updaterCacheDirName）electron-updater 自己会读
    const matched = /^\s*url:\s*(\S+)\s*$/m.exec(readFileSync(configPath, 'utf8'))
    feedUrl = matched ? matched[1] : null
  } catch (error) {
    feedUrl = null
    mainLog.warn('updater', `读取 app-update.yml 失败：${String(error)}`)
  }

  if (!feedUrl) {
    supported = false
    unsupportedReason = 'app-update.yml 里没有可用的更新地址'
    return
  }

  supported = true
  unsupportedReason = null
}

/**
 * 拉 `policy.json` 拿最低可用版本。
 *
 * 失败一律返回 null（= 不强制）。这里刻意**不做重试**：策略是"下次检查再说"的东西，
 * 为它多打几次请求不划算，离线用户还会白白等超时。
 */
async function fetchMinSupportedVersion(): Promise<string | null> {
  if (!feedUrl) return null
  const url = `${feedUrl.replace(/\/+$/, '')}/policy.json`
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), POLICY_TIMEOUT)
  try {
    const res = await fetch(url, { signal: controller.signal, cache: 'no-store' })
    if (!res.ok) return null
    const json = (await res.json()) as { min_supported_version?: unknown }
    const min = json.min_supported_version
    return typeof min === 'string' && min.trim() ? min.trim() : null
  } catch {
    return null
  } finally {
    clearTimeout(timer)
  }
}

/** 拿策略并据此判定是否需要强制更新；`info.version` 为空说明没有新版，直接不强制 */
async function applyPolicy(newVersion: string | null): Promise<void> {
  const min = await fetchMinSupportedVersion()
  state.minSupportedVersion = min
  state.mandatory = Boolean(min && newVersion && compareVersion(state.currentVersion, min) < 0)
  mainLog.info(
    'updater',
    min
      ? `最低可用版本 ${min}，当前 v${state.currentVersion}${state.mandatory ? '（低于最低版本，强制更新）' : ''}`
      : '未取到更新策略（policy.json），按非强制处理'
  )
  broadcast()
}

// ────────────────────────────── 动作 ──────────────────────────────

async function runCheck(manual: boolean): Promise<UpdateState> {
  if (!supported) {
    if (manual) state.error = unsupportedReason
    state.phase = 'unsupported'
    return snapshot()
  }
  if (state.phase === 'checking' || state.phase === 'downloading') return snapshot()

  state.phase = 'checking'
  state.error = null
  broadcast()

  try {
    const result = await updater.checkForUpdates()
    // 事件回调里已经更新过状态；这里只兜"没拿到结果也不算失败"的情况
    if (!result) {
      state.phase = state.info ? 'available' : 'idle'
      state.checkedAt = Date.now()
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    state.phase = 'error'
    state.error = message
    state.checkedAt = Date.now()
    // 自动检查失败静默：用户不需要知道"刚才后台检查没成功"
    if (manual) mainLog.warn('updater', `手动检查失败：${message}`)
    else mainLog.info('updater', `后台检查失败（已忽略）：${message}`)
  }
  broadcast()
  return snapshot()
}

async function runDownload(): Promise<UpdateState> {
  if (!supported || state.phase === 'downloading' || state.phase === 'downloaded') return snapshot()
  if (!state.info) return snapshot()

  state.phase = 'downloading'
  state.error = null
  state.progress = { percent: 0, transferred: 0, total: state.info.size ?? 0, bytesPerSecond: 0 }
  broadcast()

  cancelToken = new CancellationToken()
  try {
    await updater.downloadUpdate(cancelToken)
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    if (/cancel/i.test(message)) {
      // 用户点的取消，不是错误
      state.phase = 'available'
      state.progress = null
      mainLog.info('updater', '下载已取消')
    } else {
      state.phase = 'error'
      state.error = message
      mainLog.warn('updater', `下载失败：${message}`)
    }
  } finally {
    cancelToken = null
    broadcast()
  }
  return snapshot()
}

function runCancel(): UpdateState {
  if (state.phase !== 'downloading') return snapshot()
  cancelToken?.cancel()
  return snapshot()
}

function runInstall(): void {
  if (state.phase !== 'downloaded') return
  mainLog.info('updater', `重启并安装 v${state.info?.version ?? '?'}`)
  // 先置位：否则 quitAndInstall 触发的 close 会被窗口拦回托盘，安装器根本起不来
  setQuitting(true)
  updater.quitAndInstall(false, true)
}

// ────────────────────────────── 事件接线 ──────────────────────────────

function wireEvents(): void {
  updater.on('checking-for-update', () => {
    mainLog.info('updater', '开始检查更新')
  })

  updater.on('update-available', (info: UpdateInfo) => {
    state.phase = 'available'
    state.info = toLite(info)
    state.error = null
    state.checkedAt = Date.now()
    broadcast()
    mainLog.info('updater', `发现新版本 v${info.version}（当前 v${state.currentVersion}）`)
    // 策略单独拉，慢一点也不能拖住"有新版本"这个反馈
    void applyPolicy(info.version)
  })

  updater.on('update-not-available', () => {
    state.phase = 'not-available'
    state.info = null
    state.progress = null
    state.mandatory = false
    state.checkedAt = Date.now()
    broadcast()
    mainLog.info('updater', '已是最新版本')
    void applyPolicy(null)
  })

  updater.on('download-progress', (progress: ProgressInfo) => {
    state.phase = 'downloading'
    state.progress = {
      percent: Math.round(progress.percent),
      transferred: progress.transferred,
      total: progress.total,
      bytesPerSecond: progress.bytesPerSecond
    }
    broadcast()
  })

  updater.on('update-downloaded', (info: UpdateInfo) => {
    state.phase = 'downloaded'
    state.info = toLite(info)
    state.progress = {
      percent: 100,
      transferred: info.files?.[0]?.size ?? 0,
      total: info.files?.[0]?.size ?? 0,
      bytesPerSecond: 0
    }
    broadcast()
    mainLog.info('updater', `下载完成 v${info.version}，等待重启安装`)
  })

  updater.on('error', (error: Error) => {
    // 下载中出错时 downloadUpdate 的 catch 也会跑一遍，这里的赋值是幂等的
    state.phase = 'error'
    state.error = error?.message ?? String(error)
    state.progress = null
    state.checkedAt = Date.now()
    mainLog.warn('updater', `更新出错：${state.error}`)
    broadcast()
  })
}

// ────────────────────────────── 对外入口 ──────────────────────────────

/** 注册 IPC（`app.whenReady()` 之后、建窗口之前都可以调） */
export function registerUpdaterIpc(): void {
  ipcMain.handle('updater:state', () => snapshot())
  ipcMain.handle('updater:check', () => runCheck(true))
  ipcMain.handle('updater:download', () => runDownload())
  ipcMain.handle('updater:cancel', () => runCancel())
  ipcMain.handle('updater:install', () => runInstall())
}

/**
 * 启动更新器（`app.whenReady()` 之后调用，且要在托盘之后 —— tooltip 会用到它）
 *
 * 不支持的环境（dev / 绿色版）只把状态标成 `unsupported` 就结束，
 * **不注册定时器**，避免在开发时每 6 小时往日志里写一条无效检查。
 */
export function initUpdater(): void {
  detectSupport()

  if (!supported) {
    state.phase = 'unsupported'
    state.unsupportedReason = unsupportedReason
    state.currentVersion = app.getVersion()
    mainLog.info('updater', `未启用更新：${unsupportedReason}`)
    return
  }

  updater.autoDownload = false
  updater.autoInstallOnAppQuit = true
  updater.allowDowngrade = false
  // 复用 T6.2 的 electron-log：更新链路的日志和主进程其它日志落同一个文件
  updater.logger = log.scope('updater') as unknown as AppUpdater['logger']

  wireEvents()

  mainLog.info('updater', `更新已启用，feed=${feedUrl}，当前 v${state.currentVersion}`)

  checkTimer = setTimeout(() => {
    void runCheck(false)
  }, STARTUP_DELAY)
  checkInterval = setInterval(() => {
    void runCheck(false)
  }, CHECK_INTERVAL)

  // 退出时清掉定时器：不清的话 will-quit 之后还可能再触发一次检查
  app.on('will-quit', () => {
    if (checkTimer) clearTimeout(checkTimer)
    if (checkInterval) clearInterval(checkInterval)
    checkTimer = null
    checkInterval = null
  })
}
