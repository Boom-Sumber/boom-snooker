/**
 * 邀请码预校验（D27）
 *
 * 为什么需要这一层：
 *   强制校验在数据库 `handle_new_user` 触发器里（`signUp` 不合法会被拒），
 *   但那是**提交之后**才知道结果。用户填错码要等一整轮表单提交才发现，体验很差。
 *   所以注册框在失焦时先问一句 —— 这就是 `validate_invite_code()` RPC 的用途。
 *
 * 它只负责「即时反馈」，**不是安全边界**：真正的拦截永远在触发器里。
 * 客户端就算跳过这一步直接 signUp，也照样会被拒。
 *
 * ⚠️ 类型：`shared/types/db.ts` 是 migration 019 时的快照，还没有新 RPC 的签名。
 * 这里用一个局部签名的窄封装，避免为了一行调用去全量重生成类型；
 * 等 T3.8（账户管理页要调 list_users / soft_delete_user 等一批 RPC）时统一重新生成。
 */
import { supabase } from './client'

export type InviteReason = 'ok' | 'empty' | 'not_found' | 'disabled' | 'error'

export interface InviteCheckResult {
  ok: boolean
  reason: InviteReason
}

/** 失败原因 → 给用户看的中文（`ok` 不在这里，调用方自己决定成功样式） */
export const INVITE_REASON_TEXT: Record<Exclude<InviteReason, 'ok'>, string> = {
  empty: '请输入邀请码',
  not_found: '邀请码不存在，检查一下是不是输错了',
  disabled: '这个邀请码已停用，找邀请你的人要一个新的',
  error: '校验失败，检查网络后重试'
}

type RpcCall = (
  fn: string,
  args?: Record<string, unknown>
) => Promise<{ data: unknown; error: { message?: string } | null }>

const rpc = supabase.rpc.bind(supabase) as unknown as RpcCall

/**
 * 校验邀请码
 *
 * 服务端返回 `{ ok, reason }`；网络异常统一归到 `error`，
 * 不要把它当成「码不存在」——那会把网络问题说成用户输错。
 */
export async function validateInviteCode(code: string): Promise<InviteCheckResult> {
  const trimmed = code.trim()
  if (!trimmed) return { ok: false, reason: 'empty' }

  const { data, error } = await rpc('validate_invite_code', { p_code: trimmed })
  if (error) return { ok: false, reason: 'error' }

  const payload = data as { ok?: boolean; reason?: string } | null
  if (payload?.ok) return { ok: true, reason: 'ok' }

  const reason = payload?.reason
  if (reason === 'not_found' || reason === 'disabled' || reason === 'empty') {
    return { ok: false, reason }
  }
  return { ok: false, reason: 'error' }
}

/**
 * 注册失败时把「数据库层错误」还原成能看懂的话
 *
 * 为什么需要这一步（实测结论，别删）：
 *   直接用 REST 调 `/auth/v1/signup`，错误体是
 *   `{"code":"P0001","message":"INVITE_CODE_INVALID"}` —— token 透得出来。
 *   但**走 supabase-js 的 `signUp()` 时，500 会被包装成
 *   `Database error saving new user`**，原始 token 丢了。
 *   于是「邀请码不对」在客户端只能看到一句英文。
 *
 * 做法：拿到这句兜底英文后，**重新预校验一次**邀请码，用它的结果给准确文案。
 * 如果码现在还是有效的，说明是别的数据库错误，就老实说注册失败。
 */
export async function explainSignUpFailure(message: string, inviteCode: string): Promise<string> {
  const generic = /Database error saving new user/i.test(message)
  if (!generic) return message

  const check = await validateInviteCode(inviteCode)
  if (!check.ok && check.reason !== 'ok') {
    return INVITE_REASON_TEXT[check.reason]
  }
  return '注册失败，邀请码可能刚被停用。刷新后重试，或联系邀请你的人'
}
