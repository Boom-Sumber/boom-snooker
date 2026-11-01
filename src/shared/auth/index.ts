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

/** 性别只用于「默认头像」和资料展示，两个值 */
export type Gender = 'male' | 'female'

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
  // D27：邀请码校验失败由 handle_new_user 抛异常，GoTrue 会把 token 原样透出
  if (message.includes('INVITE_CODE_REQUIRED')) return '请填写邀请码'
  if (message.includes('INVITE_CODE_INVALID')) return '邀请码无效或已停用，找邀请你的人确认'
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

/**
 * 注册（D27 邀请制 + 关闭邮箱确认，成功即登录）
 *
 * 邀请码 / 昵称 / 性别通过 `options.data` 塞进 `raw_user_meta_data`，
 * 由数据库触发器 `handle_new_user` 校验邀请码并写进 `profiles`（migration 020）。
 *
 * ⚠️ 邀请码只传 `invite_code`，**不要传 invited_by / role** ——
 * 触发器只信 code，传了也会被忽略（防客户端伪造归属）。
 */
export async function signUp(
  email: string,
  password: string,
  profile?: { nickname?: string; gender?: Gender; inviteCode?: string }
): Promise<SignInResult> {
  const { data, error } = await supabase.auth.signUp({
    email: email.trim(),
    password,
    options: {
      data: {
        nickname: profile?.nickname?.trim() || undefined,
        gender: profile?.gender,
        invite_code: profile?.inviteCode?.trim().toUpperCase() || undefined
      }
    }
  })
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

/** 读自己的 profile（昵称 / 头像 / 性别 / 角色）；未登录或没有行都返回 null */
export async function getMyProfile(): Promise<Profile | null> {
  const user = await getCurrentUser()
  if (!user) return null
  const { data, error } = await supabase
    .from('profiles')
    .select('id, nickname, avatar, gender, role, created_at')
    .eq('id', user.id)
    .maybeSingle()
  if (error) return null
  return data
}

/**
 * 改自己的资料（昵称 / 头像 / 性别）
 *
 * 只能改这三列：数据库在 013 里 `revoke update on profiles` 后只授予了列级更新权，
 * 角色变更必须走 `set_user_role` RPC —— 客户端就算传 `role` 也会被权限拒绝。
 */
export interface ProfilePatch {
  nickname?: string
  avatar?: string | null
  gender?: Gender
}

export type ProfileResult = { ok: true; profile: Profile } | { ok: false; message: string }

/** 把资料更新的报错翻成中文（约束名来自 migration 019） */
function translateProfileError(error: { message?: string; code?: string }): string {
  const raw = error.message ?? ''
  if (raw.includes('profiles_nickname_check')) return '昵称要 1~24 个字'
  if (raw.includes('profiles_gender_check')) return '性别只能是男或女'
  if (raw.includes('permission denied') || error.code === '42501') return '没有权限修改资料'
  if (raw.includes('Failed to fetch') || raw.includes('fetch failed')) {
    return '连不上服务器，检查一下网络'
  }
  return raw || '保存失败'
}

export async function updateMyProfile(patch: ProfilePatch): Promise<ProfileResult> {
  const user = await getCurrentUser()
  if (!user) return { ok: false, message: '请先登录' }

  const { data, error } = await supabase
    .from('profiles')
    .update(patch)
    .eq('id', user.id)
    .select('id, nickname, avatar, gender, role, created_at')
    .single()

  if (error) return { ok: false, message: translateProfileError(error) }
  return { ok: true, profile: data }
}

/** 当前角色码；未登录按 viewer 处理（与数据库 `current_role_code()` 的 anon 行为对齐） */
export async function getMyRole(): Promise<RoleCode | 'anon'> {
  const profile = await getMyProfile()
  if (!profile) return 'anon'
  return profile.role as RoleCode
}

/**
 * 改密：先用旧密码重新登录校验，再 `updateUser`
 *
 * ⚠️ Supabase 的 `updateUser({ password })` **不校验旧密码** —— 只要当前会话有效就能改。
 * 所以必须自己用 `signInWithPassword` 拿旧密码验一次，否则表单里的「旧密码」形同虚设。
 * 重新登录会刷新一次会话（token 换新），对后续调用没有副作用。
 */
export type PasswordResult = { ok: true } | { ok: false; message: string }

export async function changePassword(
  oldPassword: string,
  newPassword: string
): Promise<PasswordResult> {
  const user = await getCurrentUser()
  const email = user?.email
  if (!email) return { ok: false, message: '当前账号没有邮箱，无法修改密码' }

  const { error: verifyError } = await supabase.auth.signInWithPassword({
    email,
    password: oldPassword
  })
  if (verifyError) return { ok: false, message: '旧密码不对' }

  const { error } = await supabase.auth.updateUser({ password: newPassword })
  if (error) return { ok: false, message: translateAuthError(error) }

  return { ok: true }
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
