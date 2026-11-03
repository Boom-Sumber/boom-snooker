/**
 * 图片上传（彩球/进阶的击球点、蓝点、路线图）
 *
 * 三条约定：
 *   1. **统一转 WebP(q80)**（D19）：源图多是 PNG（77 MB / 326 张），
 *      转完平均 22 KB。客户端上传时也照这个标准转，避免有人传个 3 MB 的 PNG 进来
 *      把免费额度吃掉。转换在渲染进程用 canvas 做，不需要额外依赖
 *   2. **先选图、保存时才上传**：`el-upload` 必须关掉自动上传。
 *      否则用户点「取消」时文件已经进了 Storage，成为永远没人引用的孤儿
 *   3. **同一份字节只存一份**（T7.1）：路径由内容决定 ——
 *      `balls/<sha256(WebP 字节)>.webp`。同一张图无论传几次、谁传，
 *      算出来的路径都一样，于是"是否已存在"不需要查表：
 *      HEAD 探测命中就直接引用，没命中才真上传（并发下 409 也当命中）。
 *      ⚠️ hash 的是**转码后的 WebP**，不是原始 PNG —— 库里存的是 WebP，
 *      只有对"要存进去的那份字节"做 hash，才能保证内容相同 → 路径相同。
 *
 * 失败回滚：保存失败时调用 `removeUploadedImages` 把刚传上去的删掉。
 * ⚠️ **只能传 `created === true` 的路径** —— 命中已有的图可能正被别的记录引用，
 * 删掉会让那条记录当场裂图（`uploadImage` 的返回值就是为了区分这件事）。
 */
import { SUPABASE_URL, supabase } from '../api/client'

const BUCKET = 'images'
/**
 * 目录前缀与历史数据一致：彩球 `balls/<hash>.webp`、进阶 `advanced/<hash>.webp`
 * （旧数据是 `balls/<uuid>.webp`，路径对客户端是不透明字符串，混用没有影响）
 */
export type UploadDir = 'balls' | 'advanced'
const WEBP_QUALITY = 0.8

/** 上传结果：`created` 区分"这次真新建了对象"还是"复用了已有对象" */
export interface UploadedImage {
  /** Storage 里的相对路径，直接存进 `balls.*_image` / `advanced.image` */
  path: string
  /** true = 本次真的写了对象（回滚时可以删）；false = 命中已有（**绝不能删**） */
  created: boolean
}

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

/** SHA-256（hex）—— 内容寻址的 key */
async function sha256Hex(data: ArrayBuffer): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', data)
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, '0')).join('')
}

/** 公共桶直取地址（与 `imageUrl()` 拼的远程地址一致，只是这里要的是 HEAD 探测） */
function publicUrl(path: string): string {
  return `${SUPABASE_URL}/storage/v1/object/public/${BUCKET}/${path}`
}

/**
 * 探测对象是否已存在
 *
 * 用 HEAD 而不是先上传：命中时**一个字节都不用传**，也不产生一次注定失败的写请求。
 * 网络异常一律当"不存在"——让上传分支去报真正的错，别把网络抖动伪装成"已存在"。
 */
async function objectExists(path: string): Promise<boolean> {
  try {
    const response = await fetch(publicUrl(path), { method: 'HEAD' })
    return response.ok
  } catch {
    return false
  }
}

/** Supabase Storage 的"对象已存在"有多种写法，按状态码 + 关键词一起判 */
function isDuplicate(error: { statusCode?: string; error?: string; message?: string }): boolean {
  if (error.statusCode === '409') return true
  const text = `${error.error ?? ''} ${error.message ?? ''}`.toLowerCase()
  return text.includes('duplicate') || text.includes('already exists')
}

/**
 * 上传一张图，返回 Storage 里的相对路径
 *
 * 库里存的就是这个相对路径，读的时候由 `imageUrl()` 拼成完整 URL。
 *
 * @param dir 目录前缀：彩球用 `balls`，进阶用 `advanced`
 */
export async function uploadImage(file: File, dir: UploadDir = 'balls'): Promise<UploadedImage> {
  const blob = await toWebp(file)

  // hash 算不出来（极老的环境）就退回随机命名，保证上传这条路永远能走通
  let path: string
  try {
    path = `${dir}/${await sha256Hex(await blob.arrayBuffer())}.webp`
  } catch {
    path = `${dir}/${crypto.randomUUID()}.webp`
  }

  if (await objectExists(path)) return { path, created: false }

  const { error } = await supabase.storage.from(BUCKET).upload(path, blob, {
    contentType: 'image/webp',
    // 路径是内容 hash，内容永不变化，可以放心长缓存
    cacheControl: '31536000',
    upsert: false
  })
  if (!error) return { path, created: true }
  // 并发：两台设备同时传同一张新图，一方会吃 409 —— 对方已经写好了，直接用
  if (isDuplicate(error)) return { path, created: false }

  throw new Error(`上传失败：${error.message}`)
}

/**
 * 批量删除（保存失败时回滚用）
 *
 * ⚠️ **只能传 `created === true` 的路径**。去重之后同一个对象可能被多条记录引用，
 * 删掉命中已有的那张会让别的记录裂图。
 *
 * **不要用它删"编辑前的旧图"** —— 旧图可能被历史记录引用，删了会让老卡片裂图。
 * 换图时旧文件保留在 Storage 里（每张 22 KB，不值得为此写回收逻辑）；
 * 真正的孤儿由超管在「回收站」里对账清理（T7.3）。
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
