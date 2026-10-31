/**
 * 进阶系列的写操作（走 RPC）
 *
 * 与彩球同构（见 `record.ts`），字段少很多：系列 / 标题 / 描述 / 注解 / 1 张图。
 * 必填只有**系列、标题、图片**三项 —— 与旧版 `ExcelAdvanceTableUI` 的 `[Required]` 一致，
 * 描述与注解可以为空。
 */
import { supabase } from './client'
import { asJson, translateError, versionArg, type WriteResult } from './record'

export type { WriteResult }

/** 提交给 `upsert_advanced` 的字段（id 为空表示新增） */
export interface AdvancedPayload {
  id?: string
  category_code: string
  title: string
  description: string
  content: string
  image: string
}

export async function upsertAdvanced(
  payload: AdvancedPayload,
  expectedVersion: number | null
): Promise<WriteResult> {
  const { data, error } = await supabase.rpc('upsert_advanced', {
    p: asJson(payload),
    expected_version: versionArg(expectedVersion)
  })

  if (error) return translateError(error)

  const result = data as { id?: string } | null
  return { ok: true, id: result?.id }
}

/** 删除（服务端是软删：`state = 0`，只能删自己的） */
export async function deleteAdvanced(
  id: string,
  expectedVersion: number | null
): Promise<WriteResult> {
  const { error } = await supabase.rpc('delete_advanced', {
    p_id: id,
    expected_version: versionArg(expectedVersion)
  })
  if (error) return translateError(error)
  return { ok: true }
}
