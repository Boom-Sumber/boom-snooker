/**
 * 彩球记录的写操作（走 RPC，不直接 insert/update 表）
 *
 * 为什么必须走 RPC 而不是 PostgREST 直接写：
 *   - `upsert_ball` 内部做了**归属校验**（只能改自己的）和**乐观锁**
 *     （`expected_version` 与服务端 `dataset_meta.version` 不一致就报 `VERSION_CONFLICT`）
 *   - `review_status` / `owner_id` 由触发器决定，客户端传什么都不算数（D21）
 *   - 失败 code → 中文的翻译在 `record.ts` 里，与进阶系列共用
 */
import { supabase } from './client'
import { asJson, translateError, versionArg, type WriteResult } from './record'

export type { WriteResult }

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
    p: asJson(payload),
    expected_version: versionArg(expectedVersion)
  })

  if (error) return translateError(error)

  const result = data as { id?: string } | null
  return { ok: true, id: result?.id }
}

/** 删除（服务端是软删：`state = 0`，只能删自己的） */
export async function deleteBall(id: string, expectedVersion: number | null): Promise<WriteResult> {
  const { error } = await supabase.rpc('delete_ball', {
    p_id: id,
    expected_version: versionArg(expectedVersion)
  })
  if (error) return translateError(error)
  return { ok: true }
}
