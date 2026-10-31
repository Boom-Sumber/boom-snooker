/**
 * 图片 URL 拼装
 *
 * 库里存的是 **Storage 里的相对路径**（如 `balls/8bf1be58-....webp`），
 * 不是完整 URL —— 换项目/换域名时不用改数据。
 *
 * 桶 `images` 是 public（migration 009），走
 * `{SUPABASE_URL}/storage/v1/object/public/images/<path>` 直取，
 * 不需要签名，也不受 RLS 影响（D18：不做图片变换，只存一份 WebP）。
 */
import { SUPABASE_URL } from '../api/client'

const BUCKET = 'images'

/** 相对路径 → 可访问 URL；空值返回空串（`el-image` 会显示占位） */
export function imageUrl(path: string | null | undefined): string {
  if (!path) return ''
  // 已经是完整地址（历史数据 / 外部图）就直接用
  if (/^https?:\/\//i.test(path)) return path
  return `${SUPABASE_URL}/storage/v1/object/public/${BUCKET}/${path.replace(/^\/+/, '')}`
}
