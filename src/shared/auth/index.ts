/**
 * 认证：登录 / 登出 / 会话 / 我的资料
 *
 * 业务代码**不要直接调 `supabase.auth.*`**，统一走这里 ——
 * 这样登出时的保险箱清理、错误信息中文化、会话变更订阅都只有一处实现。
 *
 * 与 D22 的关系：读数据不需要登录，认证只服务于「写」（评论 / 投稿 / 审核）
 * 和「看自己的东西」（待审内容、我的资料）。
 */
import type { AuthChangeEvent, Session } from '@supabase/supabase-js'
import { supabase } from '../api/client'
import type { Tables } from '../types/db'
import { clearAuthVault } from './storage'

/** profiles 表的一行（含 role，决定 UI 能力） */
export type Profile = Tables<'profiles'>

/** 四级角色，与 docs/03 第 9 节一致 */
export type RoleCode = 'viewer' | 'advanced' | 'admin' | 'superadmin'

export type SignInResult = { ok: true; session: Session } | { ok: false; message: string }

/**
 * 把 Supabase 的英文错误翻成能直接显示给用户的中文
 *
 * 匹配顺序：先看 `code`（稳定），再退回 `message` 关键字（版本升级兜底）。
 */
function translateAuthError(error: { code?: string; message?: string; status?: number }): string {
  const code = error.code ?? ''
  if (code === 'invalid_credentials') return '邮箱或密码不对'
  if (code === 'email_not_confirmed') return '邮箱还没确认，请先点邮件里的链接'
  if (code === 'user_already_exists' || code === 'email_exists') return '这个邮箱已经注册过了'
  if (code === 'weak_password') return '密码太短，至少 6 位'
  if (code === 'over_request_rate_limit' || code === 'over_email_send_rate_limit') {
    return '操作太频繁，等一会儿再试'
  }

  const message = error.message ?? ''
  if (message.includes('Invalid login credentials')) return '邮箱或密码不对'
  if (message.includes('Email not confirmed')) return '邮箱还没确认，请先点邮件里的链接'
  if (message.includes('Failed to fetch') || message.includes('fetch failed')) {
    return '连不上服务器，检查一下网络'
  }
  if (error.status === 0) return '连不上服务器，检查一下网络'
  return message || '登录失败，请重试'
}

/** 邮箱密码登录 */
export async function signIn(email: string, password: string): Promise<SignInResult> {
  const { data, error } = await supabase.auth.signInWithPassword({
    email: email.trim(),
    password
  })
  if (error || !data.session) {
    return { ok: false, message: error ? translateAuthError(error) : '登录失败，请重试' }
  }
  return { ok: true, session: data.session }
}

/** 注册（D13：开放注册 + 关闭邮箱确认，成功即登录） */
export async function signUp(email: string, password: string): Promise<SignInResult> {
  const { data, error } = await supabase.auth.signUp({ email: email.trim(), password })
  if (error) return { ok: false, message: translateAuthError(error) }
  if (!data.session) {
    // 万一哪天邮箱确认被打开了，这里会走到：注册成功但没会话
    return { ok: false, message: '注册成功，但需要先确认邮箱才能登录' }
  }
  return { ok: true, session: data.session }
}

/** 登出：先通知服务端作废 refresh token，再清本地保险箱 */
export async function signOut(): Promise<void> {
  try {
    await supabase.auth.signOut()
  } finally {
    // 即使服务端请求失败也要清本地，否则会卡在「登不出去」的状态
    await clearAuthVault()
  }
}

/** 当前会话；没有则 null。启动时调一次即可让自动刷新开始计时 */
export async function getSession(): Promise<Session | null> {
  const { data } = await supabase.auth.getSession()
  return data.session ?? null
}

/** 当前用户；未登录返回 null */
export async function getCurrentUser(): Promise<Session['user'] | null> {
  const session = await getSession()
  return session?.user ?? null
}

/** 读自己的 profile（昵称 / 头像 / 角色）；未登录或没有行都返回 null */
export async function getMyProfile(): Promise<Profile | null> {
  const user = await getCurrentUser()
  if (!user) return null
  const { data, error } = await supabase
    .from('profiles')
    .select('id, nickname, avatar, role, created_at')
    .eq('id', user.id)
    .maybeSingle()
  if (error) return null
  return data
}

/** 当前角色码；未登录按 viewer 处理（与数据库 `current_role_code()` 的 anon 行为对齐） */
export async function getMyRole(): Promise<RoleCode | 'anon'> {
  const profile = await getMyProfile()
  if (!profile) return 'anon'
  return profile.role as RoleCode
}

/**
 * 订阅会话变化（登录 / 登出 / token 刷新）
 *
 * 返回取消订阅函数，组件 `onUnmounted` 里调。
 */
export function onAuthStateChange(
  callback: (event: AuthChangeEvent, session: Session | null) => void
): () => void {
  const { data } = supabase.auth.onAuthStateChange((event, session) => callback(event, session))
  return () => data.subscription.unsubscribe()
}

/**
 * 启动时调一次：把保险箱里的会话读进内存，并让自动刷新开始计时
 *
 * 失败（文件损坏 / DPAPI 解不开）按未登录处理，不阻塞启动。
 */
export async function initAuth(): Promise<Session | null> {
  try {
    return await getSession()
  } catch (error) {
    console.error('[auth] 恢复会话失败：', error)
    return null
  }
}
