/**
 * supabase-js 的 storage adapter —— 把会话交给主进程的加密保险箱
 *
 * supabase-js 默认用 localStorage 存会话（refresh token 明文，同机器可读）。
 * 这里换成 `window.api.auth`（主进程 safeStorage / DPAPI 加密落盘）。
 *
 * 为什么用 `globalThis` 而不是 `window`：
 *   `src/shared` 同时被主进程（tsconfig.node）和渲染进程（tsconfig.web）编译，
 *   主进程没有 `window` 这个标识符，直接写 `window.api` 会让 typecheck:node 报错。
 *   用 `globalThis` 断言取，两个环境都能编过；取不到时退化成内存 Map。
 */
import type { AuthVaultApi } from '../types/auth'

/** 与 supabase-js 的 SupportedStorage 结构兼容（允许返回 Promise） */
export interface AsyncStorage {
  getItem(key: string): Promise<string | null>
  setItem(key: string, value: string): Promise<void>
  removeItem(key: string): Promise<void>
}

function bridge(): AuthVaultApi | null {
  const holder = globalThis as { api?: { auth?: AuthVaultApi } }
  return holder.api?.auth ?? null
}

/** 主进程 / 单元测试等没有桥接的环境用它兜底，进程内有效、不落盘 */
const memory = new Map<string, string>()

export const authStorage: AsyncStorage = {
  async getItem(key: string): Promise<string | null> {
    const vault = bridge()
    if (vault) return vault.get(key)
    return memory.get(key) ?? null
  },

  async setItem(key: string, value: string): Promise<void> {
    const vault = bridge()
    if (vault) {
      await vault.set(key, value)
      return
    }
    memory.set(key, value)
  },

  async removeItem(key: string): Promise<void> {
    const vault = bridge()
    if (vault) {
      await vault.remove(key)
      return
    }
    memory.delete(key)
  }
}

/**
 * 清空整个保险箱（登出时兜底用）
 *
 * supabase-js 登出时会自己 `removeItem`，但异常中断时可能留下残留键，
 * 这里整箱清掉，保证「登出 = 磁盘上没有凭证」。
 */
export async function clearAuthVault(): Promise<void> {
  const vault = bridge()
  if (vault) {
    await vault.clear()
    return
  }
  memory.clear()
}
