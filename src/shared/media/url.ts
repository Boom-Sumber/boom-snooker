/**
 * 图片 URL 拼装
 *
 * 库里存的是 **Storage 里的相对路径**（如 `balls/8bf1be58-....webp`），
 * 不是完整 URL —— 换项目/换域名时不用改数据。
 *
 * **T5.1 起不再直连 Supabase**：`snooker-media://media/<path>` 交给主进程的
 * 自定义协议处理（`src/main/media.ts`），本地有缓存直接返回文件，没有才下载
 * 并原子落盘。渲染层拿到的仍是普通 URL，`el-image`、大图预览、懒加载都不用改。
 *
 * 保留完整 `http(s)://` 原样返回：历史数据里可能有外链图，也方便临时贴图调试。
 */
const MEDIA_SCHEME = 'snooker-media'

/** 相对路径 → 可访问 URL；空值返回空串（`el-image` 会显示占位） */
export function imageUrl(path: string | null | undefined): string {
  if (!path) return ''
  // 已经是完整地址（历史数据 / 外部图）就直接用
  if (/^https?:\/\//i.test(path)) return path
  return `${MEDIA_SCHEME}://media/${path.replace(/^\/+/, '')}`
}
