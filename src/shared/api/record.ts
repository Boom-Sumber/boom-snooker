/**
 * 记录写操作的公共部分（彩球 / 进阶共用）
 *
 * 两条记录都走 RPC（`upsert_ball` / `upsert_advanced`、`delete_*`），
 * 服务端抛的是 `FORBIDDEN` / `VERSION_CONFLICT` 这种 code，直接给用户看没意义，
 * 所以在这里统一翻成中文，两个 API 模块共用一份，避免文案各写一遍。
 */
import type { Json } from '../types/db'

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
export function translateError(error: { message?: string; code?: string } | null): WriteResult {
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
export function versionArg(expectedVersion: number | null): number {
  return (expectedVersion ?? null) as unknown as number
}

/** 把表单对象当 jsonb 传给 RPC（supabase-js 的生成类型要求 `Json`） */
export function asJson(payload: object): Json {
  return payload as unknown as Json
}
