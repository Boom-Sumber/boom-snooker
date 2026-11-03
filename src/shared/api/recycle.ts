/**
 * 回收站（T7.2，超管专用）
 *
 * 为什么单独一套接口而不是走快照：已删除的记录 `state = 0`，本来就不在快照里，
 * 而且这里要做的是**恢复 / 物理删除**这种高危写操作，只给超管。
 *
 * 三个 RPC 都在服务端用 `is_superadmin()` 再校验一次 —— 前端 `meta.roles` 只是
 * "进不去这个页面"，不能当权限边界（客户端会被反编译）。
 *
 * 口径（见 docs/06 §5.2）：
 *   · 只列 `state = 0 and hidden_reason is null`，即**作者主动删除**的
 *   · 停用账号的级联隐藏（`hidden_reason = 'owner_deleted'`）不在这里，
 *     由「账户管理 → 恢复账号」统一还原
 *   · 审核驳回（`review_status = 'rejected'`）不算删除，不进回收站
 */
import { supabase } from './client'

export type RecordType = 'ball' | 'advanced'

/** `list_deleted_records()` 的一行 */
export interface DeletedRecord {
  rec_type: RecordType
  id: string
  /** 彩球是 `method`，进阶是 `title` */
  title: string
  owner_id: string | null
  owner_nickname: string | null
  /** 作者账号是否已停用（停用时不允许恢复，见 `restore_record` 的 OWNER_DISABLED） */
  owner_deleted: boolean
  color_code: string | null
  pocket_code: string | null
  category_code: string | null
  review_status: 'pending' | 'visible' | 'rejected'
  deleted_at: string
  image_paths: string[]
  total_count: number
}

export type RecycleResult<T> = { ok: true; data: T } | { ok: false; message: string }

type RpcCall = (
  fn: string,
  args?: Record<string, unknown>
) => Promise<{ data: unknown; error: { message?: string } | null }>

const rpc = supabase.rpc.bind(supabase) as unknown as RpcCall

function translate(message: string): string {
  const raw = message ?? ''
  if (raw.includes('AUTH_REQUIRED')) return '请先登录'
  if (raw.includes('FORBIDDEN')) return '只有超级管理员能操作回收站'
  if (raw.includes('BAD_TYPE')) return '非法操作'
  if (raw.includes('NOT_FOUND')) return '这条记录已经不在回收站里了'
  if (raw.includes('OWNER_DISABLED')) return '作者账号已停用，请先在账户管理里恢复账号'
  if (raw.includes('Failed to fetch') || raw.includes('fetch failed')) {
    return '连不上服务器，检查一下网络'
  }
  return raw || '操作失败'
}

function rows<T>(data: unknown): T[] {
  return Array.isArray(data) ? (data as T[]) : []
}

/** 列表（分页）。`total` 由窗口函数带出来，每行都有同一个值 */
export async function listDeletedRecords(params: {
  type?: RecordType | null
  limit?: number
  offset?: number
}): Promise<RecycleResult<{ items: DeletedRecord[]; total: number }>> {
  const { data, error } = await rpc('list_deleted_records', {
    p_type: params.type ?? null,
    p_limit: params.limit ?? 20,
    p_offset: params.offset ?? 0
  })
  if (error) return { ok: false, message: translate(error.message ?? '') }

  const items = rows<DeletedRecord>(data).map((row) => ({
    ...row,
    // bigint 经 PostgREST 回来可能是字符串，统一成数字
    total_count: Number(row.total_count ?? 0)
  }))
  return { ok: true, data: { items, total: items[0]?.total_count ?? 0 } }
}

/** 恢复（作者仍停用时服务端抛 OWNER_DISABLED） */
export async function restoreRecord(type: RecordType, id: string): Promise<RecycleResult<null>> {
  const { error } = await rpc('restore_record', { p_type: type, p_id: id })
  if (error) return { ok: false, message: translate(error.message ?? '') }
  return { ok: true, data: null }
}

/**
 * 物理删除（不可逆）
 *
 * 返回"删完之后变成孤儿"的图片路径 —— 交给 T7.3 的孤儿图清理。
 */
export async function purgeRecord(type: RecordType, id: string): Promise<RecycleResult<string[]>> {
  const { data, error } = await rpc('purge_record', { p_type: type, p_id: id })
  if (error) return { ok: false, message: translate(error.message ?? '') }
  return { ok: true, data: Array.isArray(data) ? (data as string[]) : [] }
}
