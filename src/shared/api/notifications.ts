/**
 * 审核结果 / 系统通知（T4.7 / T4.8 / T4.10）
 *
 * 通知由数据库触发器或超管发布写入，**不进快照**，客户端按需拉。
 * 客户端只有三种动作：读自己的、标已读、删自己的；伪造不了（表上没有写策略）。
 *
 * 两类通知走同一张表，用 `kind` 区分：
 *   · `system` —— 超管发布的系统通知（没有目标记录）
 *   · 其余    —— 审核结果（带审核人与审核时间，只有作者本人能看到）
 */
import { supabase } from './client'

export type NotificationKind =
  | 'comment_visible'
  | 'comment_rejected'
  | 'record_visible'
  | 'record_rejected'
  | 'system'
  | 'role_changed'

/** 列表范围：全部 / 只看审核结果 / 只看系统通知 */
export type NotificationScope = 'all' | 'review' | 'system'

export interface NotificationItem {
  id: string
  kind: NotificationKind
  title: string
  /** 审核结果：通过 = 内容摘要，驳回 = 驳回原因；系统通知 = 正文 */
  body: string | null
  /** 系统通知没有目标记录 */
  target_type: 'ball' | 'advanced' | null
  target_id: string | null
  /** 谁审的（系统通知是发布人）—— 只对通知所有者可见 */
  reviewer_name: string | null
  reviewed_at: string | null
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

export function translateNotificationError(message: string): string {
  const raw = message ?? ''
  if (raw.includes('AUTH_REQUIRED')) return '请先登录'
  if (raw.includes('FORBIDDEN')) return '只有超级管理员能发布系统通知'
  if (raw.includes('EMPTY_TITLE')) return '标题不能为空'
  if (raw.includes('TITLE_TOO_LONG')) return '标题最多 60 字'
  if (raw.includes('BODY_TOO_LONG')) return '正文最多 500 字'
  if (raw.includes('Failed to fetch') || raw.includes('fetch failed')) {
    return '连不上服务器，检查一下网络'
  }
  return raw || '操作失败，请重试'
}

/** 我的通知（最新在上）；`scope` 决定看全部还是只看某一类 */
export async function listNotifications(
  options: { limit?: number; offset?: number; scope?: NotificationScope } = {}
): Promise<NotificationResult<{ items: NotificationItem[]; total: number }>> {
  const { data, error } = await rpc('list_notifications', {
    p_limit: options.limit ?? 20,
    p_offset: options.offset ?? 0,
    p_scope: options.scope ?? 'all'
  })
  if (error) return { ok: false, message: translateNotificationError(error.message ?? '') }

  const items = (data ?? []) as NotificationItem[]
  return { ok: true, data: { items, total: items[0]?.total ?? 0 } }
}

/** 未读数（顶部角标）；未登录返回 0 */
export async function countUnreadNotifications(): Promise<NotificationResult<number>> {
  const { data, error } = await rpc('count_unread_notifications')
  if (error) return { ok: false, message: translateNotificationError(error.message ?? '') }
  return { ok: true, data: Number(data ?? 0) }
}

/** 通知条数（全部 / 系统类 / 未读），用于弹窗页签上的数字 */
export interface NotificationCounts {
  all: number
  system: number
  unread: number
}

export async function notificationCounts(): Promise<NotificationResult<NotificationCounts>> {
  const { data, error } = await rpc('notification_counts')
  if (error) return { ok: false, message: translateNotificationError(error.message ?? '') }

  const raw = (data ?? {}) as Partial<NotificationCounts>
  return {
    ok: true,
    data: {
      all: Number(raw.all ?? 0),
      system: Number(raw.system ?? 0),
      unread: Number(raw.unread ?? 0)
    }
  }
}

/** 标已读：不传 ids = 全部已读 */
export async function markNotificationsRead(ids?: string[]): Promise<NotificationResult<number>> {
  const { data, error } = await rpc('mark_notifications_read', { p_ids: ids ?? null })
  if (error) return { ok: false, message: translateNotificationError(error.message ?? '') }
  return { ok: true, data: Number(data ?? 0) }
}

/** 删一条自己的通知（系统通知删的是自己那份副本） */
export async function deleteNotification(id: string): Promise<NotificationResult<number>> {
  const { data, error } = await rpc('delete_notification', { p_id: id })
  if (error) return { ok: false, message: translateNotificationError(error.message ?? '') }
  return { ok: true, data: Number(data ?? 0) }
}

/** 清空自己的已读通知 */
export async function clearReadNotifications(): Promise<NotificationResult<number>> {
  const { data, error } = await rpc('clear_read_notifications')
  if (error) return { ok: false, message: translateNotificationError(error.message ?? '') }
  return { ok: true, data: Number(data ?? 0) }
}

/**
 * 发布系统通知（仅超管）
 *
 * 服务端 fan-out：给所有未停用账号各插一条，返回收到的人数。
 */
export async function publishSystemNotice(
  title: string,
  body: string
): Promise<NotificationResult<number>> {
  const { data, error } = await rpc('publish_system_notice', {
    p_title: title,
    p_body: body.trim() === '' ? null : body.trim()
  })
  if (error) return { ok: false, message: translateNotificationError(error.message ?? '') }
  return { ok: true, data: Number(data ?? 0) }
}
