/**
 * Supabase 客户端单例
 *
 * 全应用只从这里拿 client，不要在别处再 `createClient` —— 多实例会导致
 * auth 会话各存一份、token 刷新互相打架。
 *
 * 配置来源：`.env.local` 的 `VITE_SUPABASE_URL` / `VITE_SUPABASE_KEY`。
 * 这两个值在**构建时**被静态替换，改了必须重启 dev server。
 *
 * 安全边界：客户端只持有 publishable key，权限全部由 RLS + RPC 兜底。
 * 绝不在这里（或任何打包进客户端的代码里）出现 service_role key。
 */
import { createClient, type SupabaseClient } from '@supabase/supabase-js'
import type { Database } from '../types/db'
import { authStorage } from '../auth/storage'

/** 带 Database 泛型的客户端类型，业务代码统一用它做标注 */
export type DbClient = SupabaseClient<Database>

function requireEnv(name: string, value: string | undefined): string {
  if (!value) {
    throw new Error(
      `[supabase] 缺少环境变量 ${name}。\n` +
        `请在项目根目录的 .env.local 里补上，然后重启 dev server` +
        `（变量是构建时注入的，热更新不生效）。`
    )
  }
  return value
}

export const SUPABASE_URL = requireEnv('VITE_SUPABASE_URL', import.meta.env.VITE_SUPABASE_URL)
export const SUPABASE_KEY = requireEnv('VITE_SUPABASE_KEY', import.meta.env.VITE_SUPABASE_KEY)

export const supabase: DbClient = createClient<Database>(SUPABASE_URL, SUPABASE_KEY, {
  auth: {
    // 桌面端没有 OAuth 回调页，关掉 URL 里的 session 探测
    detectSessionInUrl: false,
    // 会话交给主进程 safeStorage（DPAPI）加密落盘，不用 localStorage 明文
    storage: authStorage,
    persistSession: true,
    autoRefreshToken: true,
    // 独立 key，避免和同域其他应用串号
    storageKey: 'snooker.auth'
  }
})
