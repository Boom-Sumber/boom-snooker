/**
 * 彩球记录的写操作（走 RPC，不直接 insert/update 表）
 *
 * 为什么必须走 RPC 而不是 PostgREST 直接写：
 *   - `upsert_ball` 内部做了**归属校验**（只能改自己的）和**乐观锁**
 *     （`expected_version` 与服务端 `dataset_meta.version` 不一致就报 `VERSION_CONFLICT`）
 *   - `review_status` / `owner_id` 由触发器决定，客户端传什么都不算数（D21）
 *   - 失败时抛的是 `FORBIDDEN` / `VERSION_CONFLICT` 这种 code，直接显示给用户看不懂，
 *     所以这里统一翻成中文
 */
import { supabase } from './client'
import type { Json } from '../types/db'

/** 提交给 `upsert_ball` 的字段（id 为空表示新增） */
export interface BallPayload {
  id?: string
  color_code: string
  pocket_code: string
  method: string
  strength_code: string
  sight: string
  low_comp: string
  high_comp: string
  remark: string
  impact_image: string
  blue_image: string
  route_image: string
}

export interface WriteResult {
  ok: boolean
  /** 失败时的中文提示 */
  message?: string
  /** 版本冲突：调用方应提示"数据已更新"并触发一次同步 */
  conflict?: boolean
  /** 成功后服务端返回的 id */
  id?: string
}

/** 把 Postgres 抛出的 code 翻成中文 */
function translate(error: { message?: string; code?: string } | null): WriteResult {
  const raw = error?.message ?? ''
  if (raw.includes('VERSION_CONFLICT')) {
    return { ok: false, conflict: true, message: '数据已被其他人更新，请刷新后重试' }
  }
  if (raw.includes('FORBIDDEN')) {
    return { ok: false, message: '没有权限修改这条记录' }
  }
  if (raw.includes('duplicate key')) {
    return { ok: false, message: '这条记录已经存在' }
  }
  if (raw.includes('Failed to fetch') || raw.includes('fetch failed') || error?.code === '') {
    return { ok: false, message: '连不上服务器，检查一下网络' }
  }
  return { ok: false, message: raw || '保存失败' }
}

/**
 * 生成类型里 `expected_version` 标的是 `number`，但 SQL 里它允许 null
 * （`if expected_version is not null and cur <> expected_version`）。
 * 传 null = 跳过乐观锁，这里用断言把 null 送进去，别改成 0 —— 0 会直接报冲突。
 */
function versionArg(expectedVersion: number | null): number {
  return (expectedVersion ?? null) as unknown as number
}

/**
 * 新增或更新一条彩球打法
 *
 * @param payload 表单字段
 * @param expectedVersion 当前快照版本（乐观锁）；传 null 表示不校验
 */
export async function upsertBall(
  payload: BallPayload,
  expectedVersion: number | null
): Promise<WriteResult> {
  const { data, error } = await supabase.rpc('upsert_ball', {
    p: payload as unknown as Json,
    expected_version: versionArg(expectedVersion)
  })

  if (error) return translate(error)

  const result = data as { id?: string } | null
  return { ok: true, id: result?.id }
}

/** 删除（服务端是软删：`state = 0`，只能删自己的） */
export async function deleteBall(id: string, expectedVersion: number | null): Promise<WriteResult> {
  const { error } = await supabase.rpc('delete_ball', {
    p_id: id,
    expected_version: versionArg(expectedVersion)
  })
  if (error) return translate(error)
  return { ok: true }
}
