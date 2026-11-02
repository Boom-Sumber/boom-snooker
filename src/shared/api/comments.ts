/**
 * 评论 API（T4.1）
 *
 * 读走 `list_comments` RPC，写走 `create_comment` RPC —— 都不直连 `comments` 表。
 *
 * 为什么读也要走 RPC（不是直接 select）：
 *   · 021 之后 `profiles` 只对自己 / 自己邀请的人 / 超管可读，
 *     评论区的作者昵称与头像从表里拿不到；RPC 在函数内 join，不放开 profiles 读权
 *   · `author_deleted`（D30「已停用」标识）只能靠 join `profiles.deleted_at` 算出来，
 *     评论不进快照，所以这个字段必须随查询实时返回
 *   · 可见范围（公开区 + 自己的三态 + 有审核权的范围）由服务端一个函数表达，
 *     客户端不用拼三段查询，也不会因为漏条件而泄露待审评论
 *
 * ⚠️ 类型：`shared/types/db.ts` 还是旧快照，没有这两个 RPC 的签名。
 * 这里用局部签名 + 手写返回类型收口（同 `admin.ts` / `invite.ts`），
 * 以后统一重新生成类型时可以把 cast 去掉。
 */
import { supabase } from './client'

export type CommentTargetType = 'ball' | 'advanced'
export type CommentStatus = 'pending' | 'visible' | 'rejected'

/** `list_comments` 的一行 */
export interface CommentItem {
  id: string
  content: string
  status: CommentStatus
  created_at: string
  user_id: string
  nickname: string
  /** 头像 key（`avatar-boy` / `avatar-girl`），为 null 时按 gender 回落 */
  avatar: string | null
  gender: string
  /** 作者账号已停用（D30），UI 在昵称旁显示灰胶囊 */
  author_deleted: boolean
  /** 驳回原因：只有自己的评论才有值，别人的恒为 null */
  review_note: string | null
  /** 谁审的 + 审核时间 + 审核人角色：只给自己的评论（T4.10 / T4.13） */
  reviewer_name: string | null
  reviewer_role: string | null
  reviewed_at: string | null
  /**
   * 当前调用者可见的总条数（不是全表）。
   * 注意：**这一页为空时 total 为 0**（窗口函数数不到行），
   * 所以它只用于「还有没有下一页」，展示条数请用 `getCommentCounts`
   */
  total: number
}

export type CommentResult<T> = { ok: true; data: T } | { ok: false; message: string }

/** `list_pending_comments` 的一行：待审评论 + 它挂在哪条记录上 */
export interface PendingComment {
  id: string
  content: string
  created_at: string
  user_id: string
  nickname: string
  author_deleted: boolean
  target_type: CommentTargetType
  target_id: string
  /** 彩球专属：颜色 / 袋口 code（前端用 `dataset.dictName` 映射成中文） */
  target_color: string | null
  target_pocket: string | null
  target_method: string | null
  /** 进阶专属：标题 / 系列 code */
  target_title: string | null
  target_category: string | null
  total: number
}

export type ReviewDecision = 'visible' | 'rejected'

type RpcCall = (
  fn: string,
  args?: Record<string, unknown>
) => Promise<{ data: unknown; error: { message?: string } | null }>

const rpc = supabase.rpc.bind(supabase) as unknown as RpcCall

/**
 * 服务端错误 token → 中文
 *
 * RPC 里 `raise exception 'X'` 抛出来的消息，经 supabase-js 后 `message` 就是 `X`
 * （偶尔带 `P0001:` 前缀），用 includes 匹配，别用全等。
 */
export function translateCommentError(message: string): string {
  const raw = message ?? ''
  if (raw.includes('RATE_LIMIT_MINUTE')) return '发得太快了，1 分钟只能发 1 条'
  if (raw.includes('RATE_LIMIT_DAY')) return '今天已经发了 20 条，明天再来吧'
  if (raw.includes('EMPTY_CONTENT')) return '评论内容不能为空'
  if (raw.includes('TOO_LONG')) return '评论最多 300 字'
  if (raw.includes('TARGET_NOT_FOUND')) return '这条内容不在了，刷新一下再试'
  if (raw.includes('ACCOUNT_DISABLED')) return '账号已停用，请联系管理员'
  if (raw.includes('AUTH_REQUIRED')) return '请先登录再评论'
  if (raw.includes('BAD_TYPE') || raw.includes('BAD_TARGET')) return '评论目标不合法'
  if (raw.includes('NOT_PENDING')) return '这条评论已经被处理过了'
  if (raw.includes('BAD_DECISION')) return '审核结论不合法'
  if (raw.includes('FORBIDDEN')) return '没有权限审核这条评论'
  if (raw.includes('Failed to fetch') || raw.includes('fetch failed')) {
    return '连不上服务器，检查一下网络'
  }
  return raw || '操作失败，请重试'
}

/**
 * 评论分页列表（最新在上）
 *
 * 匿名也能调：服务端只返回 `visible`。登录后自己的待审 / 驳回评论也一并返回，
 * 有审核权的按邀请归属看到别人待审的。
 */
export async function listComments(
  type: CommentTargetType,
  targetId: string,
  options: { limit?: number; offset?: number } = {}
): Promise<CommentResult<{ items: CommentItem[]; total: number }>> {
  const { data, error } = await rpc('list_comments', {
    p_type: type,
    p_target_id: targetId,
    p_limit: options.limit ?? 20,
    p_offset: options.offset ?? 0
  })
  if (error) return { ok: false, message: translateCommentError(error.message ?? '') }

  const items = (data ?? []) as CommentItem[]
  return { ok: true, data: { items, total: items[0]?.total ?? 0 } }
}

/**
 * 发评论
 *
 * 服务端强制 `status = 'pending'`（铁律 5），客户端传什么都不算数；
 * 成功返回的 id 可以直接用于乐观插入，但列表里显示「审核中」要等重新查询。
 */
export async function createComment(
  type: CommentTargetType,
  targetId: string,
  content: string
): Promise<CommentResult<{ id: string; status: CommentStatus }>> {
  const { data, error } = await rpc('create_comment', {
    p_type: type,
    p_target_id: targetId,
    p_content: content
  })
  if (error) return { ok: false, message: translateCommentError(error.message ?? '') }
  return { ok: true, data: data as { id: string; status: CommentStatus } }
}

/**
 * 批量查评论数（列表页角标用）
 *
 * 服务端只数 `status = 'visible'` 且未删除的 —— 待审评论不计入公开数，
 * 这正是 T4.2「作者看到审核中标签，但公开数不变」的依据。
 * 返回 Map 方便按 id 取；没有评论的记录不会出现在 Map 里（取不到按 0 处理）。
 */
export async function getCommentCounts(
  type: CommentTargetType,
  ids: string[]
): Promise<CommentResult<Map<string, number>>> {
  if (ids.length === 0) return { ok: true, data: new Map() }

  const { data, error } = await rpc('get_comment_counts', { p_type: type, p_ids: ids })
  if (error) return { ok: false, message: translateCommentError(error.message ?? '') }

  const rows = (data ?? []) as { target_id: string; cnt: number }[]
  return { ok: true, data: new Map(rows.map((r) => [r.target_id, Number(r.cnt)])) }
}

/**
 * 待审评论队列（管理员）
 *
 * 范围由服务端决定：admin 只看到自己邀请的人写的，超管只看直邀的（D28）。
 * 非管理员调用会拿到 `FORBIDDEN`。
 */
export async function listPendingComments(
  options: { limit?: number; offset?: number } = {}
): Promise<CommentResult<{ items: PendingComment[]; total: number }>> {
  const { data, error } = await rpc('list_pending_comments', {
    p_limit: options.limit ?? 50,
    p_offset: options.offset ?? 0
  })
  if (error) return { ok: false, message: translateCommentError(error.message ?? '') }

  const items = (data ?? []) as PendingComment[]
  return { ok: true, data: { items, total: items[0]?.total ?? 0 } }
}

/** 待审计数（顶部角标轮询用）；非管理员服务端直接返回 0 */
export async function countPendingComments(): Promise<CommentResult<number>> {
  const { data, error } = await rpc('count_pending_comments')
  if (error) return { ok: false, message: translateCommentError(error.message ?? '') }
  return { ok: true, data: Number(data ?? 0) }
}

/**
 * 审核一条评论
 *
 * `decision` 只能是 `visible`（通过）/ `rejected`（驳回）；
 * 服务端还会再校验一次"这条是不是你该审的"，前端过滤只是少犯错。
 */
export async function reviewComment(
  id: string,
  decision: ReviewDecision,
  note = ''
): Promise<CommentResult<null>> {
  const { error } = await rpc('review_comment', {
    p_id: id,
    p_decision: decision,
    p_note: note.trim() === '' ? null : note.trim()
  })
  if (error) return { ok: false, message: translateCommentError(error.message ?? '') }
  return { ok: true, data: null }
}
