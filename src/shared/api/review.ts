/**
 * 记录审核 API（T4.5）
 *
 * 背景：高级用户投稿后记录是 `review_status = 'pending'`（D21），但之前**没有任何界面能审**
 * —— 全仓只有 `review_record` RPC，管理员得知道 id 才能审，等于投稿永远进不了公开区。
 *
 * 两个读接口走 RPC（`list_pending_records` / `count_pending_records`），
 * 写走 `review_record`（021 已按归属收窄，前端过滤只是少犯错）。
 *
 * ⚠️ 记录与评论不同：记录**在快照里**，审核通过会让 `dataset_version` +1。
 * 所以审核成功后调用方要主动 `dataset.sync(true)`，否则列表页看不到这条新记录。
 */
import { supabase } from './client'

export type ReviewDecision = 'visible' | 'rejected'

export type ReviewResult<T> = { ok: true; data: T } | { ok: false; message: string }

/** `list_pending_records` 的一行：彩球与进阶合并后的统一形状 */
export interface PendingRecord {
  record_type: 'ball' | 'advanced'
  id: string
  /** 彩球字段 */
  color_code: string | null
  pocket_code: string | null
  method: string | null
  strength_code: string | null
  /** 进阶字段 */
  category_code: string | null
  title: string | null
  /**
   * 文字预览：彩球是 `sight / low_comp / high_comp / remark`，
   * 进阶是 `description / content`。待审记录不在快照里，详情页打不开，
   * 所以审核需要的正文必须随队列一起回。
   */
  preview: Record<string, string | null> | null
  created_at: string
  owner_id: string | null
  nickname: string
  author_deleted: boolean
  total: number
}

type RpcCall = (
  fn: string,
  args?: Record<string, unknown>
) => Promise<{ data: unknown; error: { message?: string } | null }>

const rpc = supabase.rpc.bind(supabase) as unknown as RpcCall

export function translateReviewError(message: string): string {
  const raw = message ?? ''
  if (raw.includes('NOT_PENDING')) return '这条记录已经被处理过了'
  if (raw.includes('BAD_DECISION')) return '审核结论不合法'
  if (raw.includes('BAD_TYPE')) return '记录类型不合法'
  if (raw.includes('FORBIDDEN')) return '没有权限审核这条记录'
  if (raw.includes('AUTH_REQUIRED')) return '请先登录'
  if (raw.includes('Failed to fetch') || raw.includes('fetch failed')) {
    return '连不上服务器，检查一下网络'
  }
  return raw || '操作失败，请重试'
}

/** 待审记录队列（范围由服务端决定：admin 看自己邀请的，超管看直邀的） */
export async function listPendingRecords(
  options: { limit?: number; offset?: number } = {}
): Promise<ReviewResult<{ items: PendingRecord[]; total: number }>> {
  const { data, error } = await rpc('list_pending_records', {
    p_limit: options.limit ?? 50,
    p_offset: options.offset ?? 0
  })
  if (error) return { ok: false, message: translateReviewError(error.message ?? '') }

  const items = (data ?? []) as PendingRecord[]
  return { ok: true, data: { items, total: items[0]?.total ?? 0 } }
}

/** 待审记录数（顶部角标轮询用）；非管理员服务端直接返回 0 */
export async function countPendingRecords(): Promise<ReviewResult<number>> {
  const { data, error } = await rpc('count_pending_records')
  if (error) return { ok: false, message: translateReviewError(error.message ?? '') }
  return { ok: true, data: Number(data ?? 0) }
}

/**
 * 审核一条记录
 *
 * 通过 → `review_status = 'visible'` 且**会 bump 快照版本**，调用方记得同步；
 * 驳回 → 停在 `rejected`，不进快照，作者在详情页看不到（记录与评论不同，记录没有"作者可见待审"的入口）。
 */
export async function reviewRecord(
  type: 'ball' | 'advanced',
  id: string,
  decision: ReviewDecision,
  note = ''
): Promise<ReviewResult<null>> {
  const { error } = await rpc('review_record', {
    p_type: type,
    p_id: id,
    p_decision: decision,
    p_note: note.trim() === '' ? null : note.trim()
  })
  if (error) return { ok: false, message: translateReviewError(error.message ?? '') }
  return { ok: true, data: null }
}
