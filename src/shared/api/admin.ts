/**
 * 账户管理 API（D28 / D29）
 *
 * 全部走 RPC，不直接读写 `profiles`：
 *   · 可见范围由 `list_users()` 按邀请归属过滤（admin 只看自己邀请的）
 *   · 改角色 / 停用 / 恢复都带服务端二次校验，前端过滤选项只是"少犯错"，不是安全边界
 *
 * ⚠️ 类型：`shared/types/db.ts` 还是 migration 019 时的快照，没有这批新 RPC 的签名。
 * 这里用局部签名 + 手写返回类型收口（和 `invite.ts` 同一套做法），
 * 以后统一重新生成类型时，这个文件里的 cast 可以删掉。
 */
import { supabase } from './client'

export type AdminRole = 'viewer' | 'advanced' | 'admin' | 'superadmin'

/** `list_users()` 的一行 */
export interface AdminUser {
  id: string
  nickname: string
  email: string | null
  role: AdminRole
  gender: string
  invited_by: string | null
  inviter_nickname: string | null
  invited_at: string | null
  created_at: string
  last_sign_in_at: string | null
  deleted_at: string | null
  deleted_by: string | null
  deleter_nickname: string | null
  deleted_reason: string | null
  /** 随账号停用而被隐藏的记录数（不含评论） */
  hidden_count: number
}

export type AdminResult<T> = { ok: true; data: T } | { ok: false; message: string }

type RpcCall = (
  fn: string,
  args?: Record<string, unknown>
) => Promise<{ data: unknown; error: { message?: string } | null }>

const rpc = supabase.rpc.bind(supabase) as unknown as RpcCall

/**
 * 服务端错误 token → 中文
 *
 * RPC 里 `raise exception 'X'` 抛出来的消息，经 supabase-js 后 `message` 就是 `X`
 * （偶尔带 `P0001:` 前缀），所以用 includes 匹配，别用全等。
 */
export function translateAdminError(message: string): string {
  const raw = message ?? ''
  if (raw.includes('PENDING_EXISTS')) {
    const n = raw.match(/PENDING_EXISTS:(\d+)/)?.[1] ?? '若干'
    return `这个账户还有 ${n} 条待审内容，要么先处理掉，要么勾选「连带隐藏内容」`
  }
  if (raw.includes('FORBIDDEN')) return '没有权限做这个操作'
  if (raw.includes('ALREADY_DELETED')) return '这个账户已经停用了'
  if (raw.includes('NOT_DELETED')) return '这个账户没有被停用'
  if (raw.includes('USER_NOT_FOUND')) return '找不到这个账户'
  if (raw.includes('TARGET_NOT_FOUND')) return '找不到目标账户'
  if (raw.includes('NOT_INVITER')) return '这个账户不是邀请人（只有管理员才有邀请码）'
  if (raw.includes('BAD_ROLE')) return '角色不合法'
  if (raw.includes('SAME_TARGET')) return '源和目标不能是同一个账户'
  if (raw.includes('AUTH_REQUIRED')) return '请先登录'
  if (raw.includes('Failed to fetch') || raw.includes('fetch failed')) {
    return '连不上服务器，检查一下网络'
  }
  return raw || '操作失败，请重试'
}

async function call<T>(fn: string, args?: Record<string, unknown>): Promise<AdminResult<T>> {
  const { data, error } = await rpc(fn, args)
  if (error) return { ok: false, message: translateAdminError(error.message ?? '') }
  return { ok: true, data: data as T }
}

/** 账户列表（范围由服务端决定：admin 只看自己邀请的，超管看全量） */
export function listUsers(): Promise<AdminResult<AdminUser[]>> {
  return call<AdminUser[]>('list_users')
}

/** 改角色（矩阵与范围都在服务端校验） */
export async function setUserRole(userId: string, role: AdminRole): Promise<AdminResult<null>> {
  return call<null>('set_user_role', { p_user_id: userId, p_role: role })
}

/**
 * 停用账户
 *
 * `cascade` = 连带隐藏该用户的记录与评论（只隐藏，不物理删，可随恢复还原）。
 * 不级联且还有待审内容时，服务端会抛 `PENDING_EXISTS:n`。
 */
export async function softDeleteUser(
  userId: string,
  cascade: boolean,
  reason: string
): Promise<
  AdminResult<{ ok: boolean; hidden_records: number; hidden_comments: number; reparented: number }>
> {
  return call('soft_delete_user', { p_target: userId, p_cascade: cascade, p_reason: reason })
}

/** 恢复账户；`restoreContent` = 一并恢复当初随账号隐藏的内容 */
export async function restoreUser(
  userId: string,
  restoreContent: boolean
): Promise<AdminResult<{ ok: boolean; restored_records: number; restored_comments: number }>> {
  return call('restore_user', { p_target: userId, p_restore_content: restoreContent })
}

/** 转移邀请关系（超管） */
export function transferInvitees(from: string, to: string): Promise<AdminResult<number>> {
  return call<number>('transfer_invitees', { p_from: from, p_to: to })
}

/** 我的邀请码（admin+，没有会自动生成） */
export function myInviteCode(): Promise<AdminResult<string>> {
  return call<string>('my_invite_code')
}

/** 重置我的邀请码（旧码立即作废） */
export function resetMyInviteCode(): Promise<AdminResult<string>> {
  return call<string>('reset_my_invite_code')
}

/** 查看某个管理员的邀请码（超管） */
export function inviteCodeOf(userId: string): Promise<AdminResult<string>> {
  return call<string>('invite_code_of', { p_user: userId })
}

/** 重置某个管理员的邀请码（超管） */
export function resetInviteCodeOf(userId: string): Promise<AdminResult<string>> {
  return call<string>('reset_invite_code_of', { p_user: userId })
}
