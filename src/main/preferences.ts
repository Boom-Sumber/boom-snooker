/**
 * 本机偏好（T10.1，D36）
 *
 * 注意这是**本机偏好，不是账号数据**：
 *   - 不进快照、不上云 —— 换账号不该把"关闭即退出"同步到别人机器上
 *   - 只影响本进程的行为（关闭窗口怎么办）
 *
 * 三条约束和 `store.ts` 的缓存读写一致：
 *   1. **原子替换**（铁律 10）：tmp + fsync + rename
 *   2. **读失败当默认值**：文件损坏/不存在就用默认，不让启动卡住
 *   3. **字段逐项校验**：JSON 可能被手改过，坏值一律回退到当前值而不是崩掉
 */
import { app, ipcMain } from 'electron'
import {
  closeSync,
  fsyncSync,
  mkdirSync,
  openSync,
  readFileSync,
  renameSync,
  rmSync,
  writeSync
} from 'node:fs'
import { join } from 'node:path'
import { mainLog } from './log'
import {
  START_PAGE_DEFAULT_SECONDS,
  START_PAGE_MAX_SECONDS,
  START_PAGE_MIN_SECONDS,
  type AppPreferences,
  type StartPagePreferences
} from '@shared/types/system'

/** 默认最小化到托盘：教学工具属于"随时查一眼"，关一次就退出太打断 */
const DEFAULTS: AppPreferences = {
  closeAction: 'tray',
  openAtLogin: false,
  trayHintShown: false,
  startPage: {
    enabled: true,
    autoEnterSeconds: START_PAGE_DEFAULT_SECONDS,
    poemCategories: []
  }
}

const FILE_NAME = 'app-settings.json'

/** 内存里的当前值：改设置立刻生效，写盘失败也不影响本次会话 */
let current: AppPreferences = clone(DEFAULTS)

function clone(value: AppPreferences): AppPreferences {
  return {
    ...value,
    startPage: { ...value.startPage, poemCategories: [...value.startPage.poemCategories] }
  }
}

/**
 * 校验外部传进来的启动页偏好
 *
 * JSON 可能被手改过，秒数也可能超出范围 —— 一律夹到 [5, 60]，
 * 类别去重后只保留字符串（真正的类别表在渲染层，主进程不认识它的含义，
 * 不认识就照样存着，渲染层自己会过滤）。
 */
function normalizeStartPage(raw: unknown, fallback: StartPagePreferences): StartPagePreferences {
  if (typeof raw !== 'object' || raw === null) return { ...fallback }
  const value = raw as Partial<StartPagePreferences>

  const seconds = Number(value.autoEnterSeconds)
  const autoEnterSeconds = Number.isFinite(seconds)
    ? Math.min(START_PAGE_MAX_SECONDS, Math.max(START_PAGE_MIN_SECONDS, Math.round(seconds)))
    : fallback.autoEnterSeconds

  const categories = Array.isArray(value.poemCategories)
    ? [...new Set(value.poemCategories.filter((code): code is string => typeof code === 'string'))]
    : fallback.poemCategories

  return {
    enabled: typeof value.enabled === 'boolean' ? value.enabled : fallback.enabled,
    autoEnterSeconds,
    poemCategories: categories
  }
}

function preferencesFile(): string {
  return join(app.getPath('userData'), FILE_NAME)
}

export function getPreferences(): AppPreferences {
  return clone(current)
}

/** 启动时读一次（在 `app.whenReady()` 之后调用，`userData` 才确定） */
export function initPreferences(): void {
  try {
    const raw = readFileSync(preferencesFile(), 'utf8')
    const parsed = JSON.parse(raw) as Partial<AppPreferences>
    current = {
      closeAction:
        parsed.closeAction === 'quit' || parsed.closeAction === 'tray'
          ? parsed.closeAction
          : DEFAULTS.closeAction,
      openAtLogin: typeof parsed.openAtLogin === 'boolean' ? parsed.openAtLogin : false,
      trayHintShown: typeof parsed.trayHintShown === 'boolean' ? parsed.trayHintShown : false,
      startPage: normalizeStartPage(parsed.startPage, DEFAULTS.startPage)
    }
  } catch {
    // 没有这个文件（首次启动）/ 内容坏了：都用默认值，不阻塞启动
    current = clone(DEFAULTS)
  }
}

/** 合并并落盘；返回合并后的完整偏好 */
export function updatePreferences(patch: Partial<AppPreferences>): AppPreferences {
  const next: AppPreferences = {
    closeAction:
      patch.closeAction === 'quit' || patch.closeAction === 'tray'
        ? patch.closeAction
        : current.closeAction,
    openAtLogin: typeof patch.openAtLogin === 'boolean' ? patch.openAtLogin : current.openAtLogin,
    trayHintShown:
      typeof patch.trayHintShown === 'boolean' ? patch.trayHintShown : current.trayHintShown,
    // 启动页是嵌套对象：渲染层每次传完整的一份，这里再按字段兜一次
    startPage: patch.startPage
      ? normalizeStartPage(patch.startPage, current.startPage)
      : current.startPage
  }

  current = next
  writeAtomic(preferencesFile(), JSON.stringify(next, null, 2))
  return clone(next)
}

function writeAtomic(file: string, content: string): void {
  const tmp = `${file}.${process.pid}.tmp`
  try {
    mkdirSync(app.getPath('userData'), { recursive: true })
    const fd = openSync(tmp, 'w')
    try {
      writeSync(fd, content)
      fsyncSync(fd)
    } finally {
      closeSync(fd)
    }
    renameSync(tmp, file)
  } catch (error) {
    rmSync(tmp, { force: true })
    // 写盘失败不抛给渲染层：设置值已在内存里，本次会话照样生效（T6.2 日志里有记录）
    mainLog.error('prefs', '写偏好失败', error)
  }
}

export function registerPreferencesIpc(): void {
  ipcMain.handle('prefs:get', (): AppPreferences => getPreferences())

  ipcMain.handle('prefs:set', (_event, patch: Partial<AppPreferences>): AppPreferences =>
    updatePreferences(patch ?? {})
  )
}
