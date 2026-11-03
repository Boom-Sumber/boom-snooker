/**
 * 我的投稿（T4.12）
 *
 * 为什么单独一套接口而不是走快照：
 *   待审 / 驳回的记录**不能进快照**（快照是公开分发、还会落本地缓存），
 *   否则换账号时本地缓存会串数据，匿名用户也可能看到待审内容。
 *   所以作者侧单独用 `get_my_record` / `list_my_records` 按需取。
 *
 * 这两个接口只认 `owner = auth.uid()`，别人的记录一律 `FORBIDDEN`。
 */
import { supabase } from './client'
import { isNetworkError, NETWORK_ERROR_TEXT } from '../net/online'
import type { Tables } from '../types/db'

export type ReviewStatus = 'pending' | 'visible' | 'rejected'

/** `list_my_records()` 的一行：彩球与进阶合并后的统一形状 */
export interface MyRecordItem {
  record_type: 'ball' | 'advanced'
  id: string
  review_status: ReviewStatus
  review_note: string | null
  reviewed_at: string | null
  reviewer_name: string | null
  reviewer_role: string | null
  color_code: string | null
  pocket_code: string | null
  method: string | null
  strength_code: string | null
  category_code: string | null
  title: string | null
  updated_at: string
}

export type MyRecordResult<T> = { ok: true; data: T } | { ok: false; message: string }

/** 记录行 + 审核回显字段（`get_my_record` 会把这几个键拼在整行后面） */
export type BallWithReview = Tables<'balls'> & {
  reviewer_name?: string | null
  reviewer_role?: string | null
}
export type AdvancedWithReview = Tables<'advanced'> & {
  reviewer_name?: string | null
  reviewer_role?: string | null
}

type RpcCall = (
  fn: string,
  args?: Record<string, unknown>
) => Promise<{ data: unknown; error: { message?: string } | null }>

const rpc = supabase.rpc.bind(supabase) as unknown as RpcCall

function translate(message: string): string {
  const raw = message ?? ''
  if (raw.includes('AUTH_REQUIRED')) return '请先登录'
  if (raw.includes('NOT_FOUND')) return '这条内容已经不在了'
  if (raw.includes('FORBIDDEN')) return '这不是你的投稿'
  if (isNetworkError(raw)) return NETWORK_ERROR_TEXT
  return raw || '操作失败，请重试'
}

/** 我的全部投稿（含待审 / 驳回），最新更新的在前 */
export async function listMyRecords(): Promise<MyRecordResult<MyRecordItem[]>> {
  const { data, error } = await rpc('list_my_records')
  if (error) return { ok: false, message: translate(error.message ?? '') }
  return { ok: true, data: (data ?? []) as MyRecordItem[] }
}

async function getMyRecordRow(
  type: 'ball' | 'advanced',
  id: string
): Promise<MyRecordResult<Record<string, unknown>>> {
  const { data, error } = await rpc('get_my_record', { p_type: type, p_id: id })
  if (error) return { ok: false, message: translate(error.message ?? '') }
  if (!data) return { ok: false, message: '这条内容已经不在了' }
  return { ok: true, data: data as Record<string, unknown> }
}

export async function getMyBall(id: string): Promise<MyRecordResult<BallWithReview>> {
  const result = await getMyRecordRow('ball', id)
  if (!result.ok) return result
  return { ok: true, data: result.data as unknown as BallWithReview }
}

export async function getMyAdvanced(id: string): Promise<MyRecordResult<AdvancedWithReview>> {
  const result = await getMyRecordRow('advanced', id)
  if (!result.ok) return result
  return { ok: true, data: result.data as unknown as AdvancedWithReview }
}
