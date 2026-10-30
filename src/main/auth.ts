/**
 * 认证凭据保险箱：`<userData>/auth.enc`
 *
 * 存什么：supabase-js 的会话（access token + refresh token + user），
 * 由 `src/shared/auth/storage.ts` 的 adapter 以 key/value 形式写进来。
 *
 * 怎么存：
 *   - `safeStorage.encryptString` → Windows DPAPI，密钥绑定当前 Windows 用户，
 *     换用户 / 换机器都解不开（这是它比 localStorage 强的唯一理由）
 *   - 文件内容再 base64 一层，外面套 `{ v: 1, data }` 便于以后换算法
 *   - 铁律 10：写临时文件 → 原子 rename，中断不会留下半截文件
 *
 * 不支持加密时（极少数环境）：
 *   **不落盘**，只在内存里保留本次会话 —— 宁可重启后要重新登录，也不把
 *   refresh token 明文写到磁盘上。
 */
import { app, ipcMain, safeStorage } from 'electron'
import { mkdirSync, readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'

const FILE_NAME = 'auth.enc'
const FORMAT_VERSION = 1

type Vault = Record<string, string>

let cache: Vault | null = null

function vaultFile(): string {
  return join(app.getPath('userData'), FILE_NAME)
}

function load(): Vault {
  if (cache) return cache
  try {
    const raw = JSON.parse(readFileSync(vaultFile(), 'utf8')) as {
      v?: number
      data?: string
    }
    if (raw.v !== FORMAT_VERSION || typeof raw.data !== 'string') {
      throw new Error('格式不识别')
    }
    const plain = safeStorage.decryptString(Buffer.from(raw.data, 'base64'))
    const parsed = JSON.parse(plain) as unknown
    cache = parsed && typeof parsed === 'object' ? (parsed as Vault) : {}
  } catch {
    // 首次启动没有文件、DPAPI 解不开（换了 Windows 用户）、内容损坏 —— 都当空处理
    cache = {}
  }
  return cache
}

function persist(vault: Vault): void {
  if (!safeStorage.isEncryptionAvailable()) {
    // 不落盘，只留内存。下次启动等于未登录，但不会泄露 token
    console.warn('[auth] 系统不支持 safeStorage，会话仅保存在内存中')
    return
  }
  const target = vaultFile()
  const tmp = `${target}.tmp`
  try {
    mkdirSync(dirname(target), { recursive: true })
    const data = safeStorage.encryptString(JSON.stringify(vault)).toString('base64')
    writeFileSync(tmp, JSON.stringify({ v: FORMAT_VERSION, data }), 'utf8')
    renameSync(tmp, target)
  } catch (error) {
    console.error('[auth] 保存会话失败：', error)
    rmSync(tmp, { force: true })
  }
}

function deleteFile(): void {
  try {
    rmSync(vaultFile(), { force: true })
  } catch (error) {
    console.error('[auth] 删除会话文件失败：', error)
  }
}

/** 注册 IPC。在主进程 `whenReady` 之后、创建窗口之前调用 */
export function registerAuthIpc(): void {
  ipcMain.handle('auth:get', (_event, key: string): string | null => {
    const vault = load()
    return typeof key === 'string' ? (vault[key] ?? null) : null
  })

  ipcMain.handle('auth:set', (_event, key: string, value: string): void => {
    if (typeof key !== 'string' || typeof value !== 'string') return
    const vault = load()
    vault[key] = value
    persist(vault)
  })

  ipcMain.handle('auth:remove', (_event, key: string): void => {
    const vault = load()
    if (typeof key === 'string' && key in vault) {
      delete vault[key]
      if (Object.keys(vault).length === 0) {
        deleteFile()
      } else {
        persist(vault)
      }
    }
  })

  ipcMain.handle('auth:clear', (): void => {
    cache = {}
    deleteFile()
  })

  ipcMain.handle('auth:encryption-available', (): boolean => safeStorage.isEncryptionAvailable())
}
