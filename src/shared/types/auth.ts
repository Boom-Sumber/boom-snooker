/**
 * 认证相关类型（主进程 / 预加载 / 渲染进程共用）
 *
 * 这里只放「跨进程的契约」，不放业务逻辑。业务逻辑在 `src/shared/auth/`。
 */

/**
 * 主进程提供的加密存储能力（预加载暴露为 `window.api.auth`）
 *
 * 为什么放主进程：refresh token 是长期凭证，等价于密码。
 * 渲染进程能用的 localStorage / 明文 JSON 都不安全（前者同机器任何进程可读，
 * 后者一眼可见），而 Electron 的 `safeStorage` 走 Windows DPAPI，
 * 密钥绑定当前 Windows 用户，只有该用户能解。
 *
 * 接口是「按 key 存取字符串」，语义与 Web Storage 一致，
 * 方便直接喂给 supabase-js 的 storage adapter。
 */
export interface AuthVaultApi {
  /** 读一个 key；不存在返回 null */
  get(key: string): Promise<string | null>
  /** 写一个 key（覆盖） */
  set(key: string, value: string): Promise<void>
  /** 删一个 key；不存在也不报错 */
  remove(key: string): Promise<void>
  /** 清空整个保险箱（登出时用） */
  clear(): Promise<void>
  /** 当前系统是否支持加密；false 时不落盘，只在内存里保留会话 */
  isEncryptionAvailable(): Promise<boolean>
}
