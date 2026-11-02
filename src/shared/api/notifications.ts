/**
 * 审核结果通知（T4.7）
 *
 * 通知由数据库触发器写入（评论 / 记录从 `pending` 变成 `visible`/`rejected` 时），
 * **不进快照**，所以客户端只能按需拉；写入权限完全在服务端，客户端只有"读自己的"和"标已读"。
 *
 * 为什么通知里只带 `target_type` + `target_id`：
 * 点进去要跳到那条**记录**的详情页（评论也跳它挂着的记录），
 * 记录 id 才是路由需要的；评论 id 对用户没意义。
 */
import { supabase } from './client'

export type NotificationKind =
  'comment_visible' | 'comment_rejected' | 'record_visible' | 'record_rejected'

export interface NotificationItem {
  id: string
  kind: NotificationKind
  title: string
  /** 通过 = 内容摘要；驳回 = 驳回原因 */
  body: string | null
  target_type: 'ball' | 'advanced'
  target_id: string
  read_at: string | null
  created_at: string
  total: number
}

export type NotificationResult<T> = { ok: true; data: T } | { ok: false; message: string }

type RpcCall = (
  fn: string,
  args?: Record<string, unknown>
) => Promise<{ data: unknown; error: { message?: string } | null }>

const rpc = supabase.rpc.bind(supabase) as unknown as RpcCall

function translate(message: string): string {
  const raw = message ?? ''
  if (raw.includes('AUTH_REQUIRED')) return '请先登录'
  if (raw.includes('Failed to fetch') || raw.includes('fetch failed')) {
    return '连不上服务器，检查一下网络'
  }
  return raw || '操作失败，请重试'
}

/** 我的通知（最新在上） */
export async function listNotifications(
  options: { limit?: number; offset?: number } = {}
): Promise<NotificationResult<{ items: NotificationItem[]; total: number }>> {
  const { data, error } = await rpc('list_notifications', {
    p_limit: options.limit ?? 20,
    p_offset: options.offset ?? 0
  })
  if (error) return { ok: false, message: translate(error.message ?? '') }

  const items = (data ?? []) as NotificationItem[]
  return { ok: true, data: { items, total: items[0]?.total ?? 0 } }
}

/** 未读数（顶部角标）；未登录返回 0 */
export async function countUnreadNotifications(): Promise<NotificationResult<number>> {
  const { data, error } = await rpc('count_unread_notifications')
  if (error) return { ok: false, message: translate(error.message ?? '') }
  return { ok: true, data: Number(data ?? 0) }
}

/** 标已读：不传 ids = 全部已读 */
export async function markNotificationsRead(ids?: string[]): Promise<NotificationResult<number>> {
  const { data, error } = await rpc('mark_notifications_read', { p_ids: ids ?? null })
  if (error) return { ok: false, message: translate(error.message ?? '') }
  return { ok: true, data: Number(data ?? 0) }
}
