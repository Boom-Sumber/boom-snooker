/**
 * 站点文案 API（D31）
 *
 * 只有两个写操作：保存整组（含全部条目）、删除整组。
 * 读不走这里 —— 文案随快照下发，见 `shared/sync/snapshot.ts` 的 `content` 字段。
 *
 * 服务端 `save_site_section` / `delete_site_section` 都是超管专属，
 * 前端把入口藏起来只是"少犯错"，权限判断在 RPC 里。
 */
import { supabase } from './client'
import { isNetworkError, NETWORK_ERROR_TEXT } from '../net/online'
import type { SiteSection } from '../types/content'

export type ContentResult = { ok: true } | { ok: false; message: string }

type RpcCall = (
  fn: string,
  args?: Record<string, unknown>
) => Promise<{ data: unknown; error: { message?: string } | null }>

const rpc = supabase.rpc.bind(supabase) as unknown as RpcCall

/** 服务端 token / 约束名 → 中文 */
export function translateContentError(message: string): string {
  const raw = message ?? ''
  if (raw.includes('FORBIDDEN')) return '没有权限修改文案（只有超级管理员可以）'
  if (raw.includes('KEY_REQUIRED')) return '分组标识不能为空'
  if (raw.includes('TITLE_REQUIRED')) return '分组标题不能为空'
  if (raw.includes('site_sections_title_check')) return '标题要 1~40 个字'
  if (raw.includes('site_sections_intro_check')) return '引言最多 200 个字'
  if (raw.includes('site_points_label_check')) return '标签最多 12 个字'
  if (raw.includes('site_points_body_check')) return '每条正文要 1~500 个字'
  if (isNetworkError(raw)) return NETWORK_ERROR_TEXT
  return raw || '保存失败，请重试'
}

/** 保存一组文案（整组覆盖：条目顺序按数组顺序写回） */
export async function saveSiteSection(section: SiteSection): Promise<ContentResult> {
  const { error } = await rpc('save_site_section', { p_section: section })
  if (error) return { ok: false, message: translateContentError(error.message ?? '') }
  return { ok: true }
}

/** 删除一组文案（条目随外键级联删除） */
export async function deleteSiteSection(key: string): Promise<ContentResult> {
  const { error } = await rpc('delete_site_section', { p_key: key })
  if (error) return { ok: false, message: translateContentError(error.message ?? '') }
  return { ok: true }
}
