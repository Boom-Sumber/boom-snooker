/**
 * 图片上传（彩球/进阶的击球点、蓝点、路线图）
 *
 * 两条约定：
 *   1. **统一转 WebP(q80)**（D19）：源图多是 PNG（77 MB / 326 张），
 *      转完平均 22 KB。客户端上传时也照这个标准转，避免有人传个 3 MB 的 PNG 进来
 *      把免费额度吃掉。转换在渲染进程用 canvas 做，不需要额外依赖
 *   2. **先选图、保存时才上传**：`el-upload` 必须关掉自动上传。
 *      否则用户点「取消」时文件已经进了 Storage，成为永远没人引用的孤儿
 *
 * 失败回滚：保存失败时调用 `removeUploadedImages` 把刚传上去的删掉。
 * Storage 的 delete 权限只给 `can_write_records()`，自己传的能删。
 */
import { supabase } from '../api/client'

const BUCKET = 'images'
/**
 * 目录前缀与历史数据一致：彩球 `balls/<uuid>.webp`、进阶 `advanced/<uuid>.webp`
 * （旧数据就是这么分的，迁移脚本 `upload_images.py` 按表决定前缀，这里保持一致）
 */
export type UploadDir = 'balls' | 'advanced'
const WEBP_QUALITY = 0.8

/** 浏览器能把任意图片解出来吗 —— 解不出（比如损坏文件）就在这里失败 */
async function toWebp(file: File): Promise<Blob> {
  const bitmap = await createImageBitmap(file)
  try {
    const canvas = document.createElement('canvas')
    canvas.width = bitmap.width
    canvas.height = bitmap.height
    const ctx = canvas.getContext('2d')
    if (!ctx) throw new Error('无法创建画布')
    ctx.drawImage(bitmap, 0, 0)

    const blob = await new Promise<Blob | null>((resolve) => {
      canvas.toBlob(resolve, 'image/webp', WEBP_QUALITY)
    })
    if (!blob) throw new Error('图片转换失败')
    return blob
  } finally {
    // ImageBitmap 占的是原生内存，用完要显式释放
    bitmap.close()
  }
}

/**
 * 上传一张图，返回 Storage 里的相对路径（如 `balls/xxx.webp`）
 *
 * 库里存的就是这个相对路径，读的时候由 `imageUrl()` 拼成完整 URL。
 *
 * @param dir 目录前缀：彩球用 `balls`，进阶用 `advanced`
 */
export async function uploadImage(file: File, dir: UploadDir = 'balls'): Promise<string> {
  const blob = await toWebp(file)
  const path = `${dir}/${crypto.randomUUID()}.webp`

  const { error } = await supabase.storage.from(BUCKET).upload(path, blob, {
    contentType: 'image/webp',
    cacheControl: '31536000', // 一年：文件名是 uuid，内容永不变化
    upsert: false
  })
  if (error) throw new Error(`上传失败：${error.message}`)

  return path
}

/**
 * 批量删除（保存失败时回滚用）
 *
 * **不要用它删"编辑前的旧图"** —— 旧图可能被历史记录引用，删了会让老卡片裂图。
 * 换图时旧文件保留在 Storage 里（每张 22 KB，不值得为此写回收逻辑）。
 */
export async function removeUploadedImages(paths: string[]): Promise<void> {
  const list = paths.filter((path) => path.length > 0)
  if (list.length === 0) return
  const { error } = await supabase.storage.from(BUCKET).remove(list)
  if (error) console.warn('[media] 回滚删除失败（不影响主流程）：', error.message)
}

/** 本地文件 → 可直接预览的 objectURL（记得用完 revoke） */
export function previewUrl(file: File): string {
  return URL.createObjectURL(file)
}
