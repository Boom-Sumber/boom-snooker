/**
 * 本地缓存文件读写：`<userData>/cache/<name>.json`
 *
 * 为什么放主进程：渲染进程没有 fs 权限（contextIsolation），
 * 而且缓存要在"窗口还没出来"的时候就能用。
 *
 * 三条硬约束（都来自铁律 / 踩过的坑）：
 *   1. **原子替换**（铁律 10）：先写 `<name>.json.tmp`，fsync 后 rename 覆盖目标。
 *      rename 在同一分区上是原子操作 —— 写到一半断电，目标文件要么是旧的、要么是新的，
 *      不会出现半截 JSON。直接 `writeFileSync(目标)` 就可能留下损坏的缓存。
 *   2. **name 只接受白名单字符**：渲染进程传进来的是逻辑名不是路径，
 *      拼路径前必须校验，否则 `../../evil` 能写到任意位置。
 *   3. **读失败一律当"没有缓存"**：文件损坏、被占锁、编码异常都返回 null，
 *      让上层走"重新下载"的分支，不要抛错卡住启动。
 */
import { app, ipcMain } from 'electron'
import {
  closeSync,
  fsyncSync,
  mkdirSync,
  openSync,
  readdirSync,
  readFileSync,
  renameSync,
  rmSync,
  statSync,
  writeSync
} from 'node:fs'
import { join } from 'node:path'
import type { CacheFileInfo } from '@shared/types/storage'

/**
 * 缓存目录名
 *
 * ⚠️ **不要叫 `cache`**：Electron 的 HTTP 缓存就放在 `<userData>/cache`（Windows
 * 大小写不敏感，`cache` 与 `Cache` 是同一个目录）。实测那个目录里已经有
 * `Cache_Data/` 和 `No_Vary_Search/`。把业务缓存塞进去会踩两个雷：
 *   ① Chromium 清缓存 / 版本升级时可能整目录清空，快照被顺手删掉；
 *   ② 我们的 `sweepTmpFiles` 会去扫那个目录，等于去动别人的文件。
 * 用 `data-cache` 明确隔开。
 */
const CACHE_DIR_NAME = 'data-cache'
const NAME_PATTERN = /^[a-z0-9][a-z0-9_-]{0,63}$/i

function cacheDir(): string {
  return join(app.getPath('userData'), CACHE_DIR_NAME)
}

/** 逻辑名 → 绝对路径；非法名直接抛（属于调用方 bug，不该静默） */
function resolveFile(name: string): string {
  if (typeof name !== 'string' || !NAME_PATTERN.test(name)) {
    throw new Error(`[store] 非法的缓存名：${String(name)}`)
  }
  return join(cacheDir(), `${name}.json`)
}

function readText(name: string): string | null {
  // ⚠️ resolveFile 必须在 try 外面：它是「参数合法性校验」，非法名要抛出去。
  // 放进 try 里会被下面的 catch 吞成 null，调用方把拼错的名字当成"没有缓存"，
  // 表现为"缓存永远读不到"这种极难查的问题。
  const file = resolveFile(name)
  try {
    return readFileSync(file, 'utf8')
  } catch {
    // ENOENT / EACCES / 文件被占 —— 都当作"没有缓存"
    return null
  }
}

function writeText(name: string, content: string): void {
  const target = resolveFile(name)
  const tmp = `${target}.tmp`
  mkdirSync(cacheDir(), { recursive: true })

  // fd 用完必须关，否则 Windows 上 rename 会失败（文件被占用）
  const fd = openSync(tmp, 'w')
  try {
    writeSync(fd, content)
    // 先落盘再 rename，否则断电后可能出现"名字换好了但内容是空的"
    fsyncSync(fd)
  } finally {
    closeSync(fd)
  }

  try {
    renameSync(tmp, target)
  } catch (error) {
    rmSync(tmp, { force: true })
    throw error
  }
}

function removeFile(name: string): void {
  rmSync(resolveFile(name), { force: true })
}

function statFile(name: string): CacheFileInfo | null {
  // 同上：名称校验的异常不能被吞
  const file = resolveFile(name)
  try {
    const info = statSync(file)
    return { size: info.size, mtime: info.mtimeMs }
  } catch {
    return null
  }
}

/**
 * 清理上次异常退出留下的 `.tmp` 残留
 *
 * 正常流程里 tmp 一定会被 rename 或删掉；只有进程被强杀才会剩下。
 * 这些文件不会被读到，但会白占磁盘，启动时顺手清一次。
 */
function sweepTmpFiles(): void {
  try {
    const dir = cacheDir()
    for (const entry of readdirSync(dir)) {
      if (entry.endsWith('.tmp')) rmSync(join(dir, entry), { force: true })
    }
  } catch {
    // 目录不存在（首次启动）—— 正常情况，忽略
  }
}

/** 注册 IPC。在主进程 `whenReady` 之后、创建窗口之前调用 */
export function registerStoreIpc(): void {
  sweepTmpFiles()

  ipcMain.handle('store:read', (_event, name: string): string | null => readText(name))

  ipcMain.handle('store:write', (_event, name: string, content: string): void => {
    if (typeof content !== 'string') throw new Error('[store] content 必须是字符串')
    writeText(name, content)
  })

  ipcMain.handle('store:remove', (_event, name: string): void => removeFile(name))

  ipcMain.handle('store:stat', (_event, name: string): CacheFileInfo | null => statFile(name))
}

/** 缓存目录绝对路径（排查问题用，别在业务里依赖它） */
export function cacheDirectory(): string {
  return cacheDir()
}
