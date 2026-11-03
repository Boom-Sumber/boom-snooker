/**
 * 图片本地缓存：`snooker-media://` 自定义协议（T5.1）
 *
 * 为什么要走协议而不是渲染层 fetch：
 *   渲染层的 `<img src>` 只能给 URL，给不了"先查缓存、没有就下载"的逻辑。
 *   在渲染层用 `fetch → Blob → createObjectURL` 能实现，但要改 6 个渲染点、
 *   自己管 revoke（`el-image` 的大图预览会持有旧 URL），且 blob 不参与
 *   Chromium 的图片解码缓存。协议方案只换 URL 前缀，`el-image`、预览、
 *   懒加载全部照旧可用。
 *
 * 缓存策略：
 *   - **key = 相对路径的 SHA-1**，磁盘上只有 `<sha1>.webp`，不做反向映射。
 *     文件名不参与业务，改存储布局不影响缓存命中。
 *   - **原子替换**（铁律 10）：先写 `<sha1>.webp.<pid>.tmp` → fsync → rename。
 *   - **失败绝不落盘**：非 2xx、空 body、超 5 MB 都直接返回 404，不留半截文件。
 *   - **不做淘汰**：全量 6.7 MB（D18/D19），100 人也才这个量级，LRU 是过度设计。
 *   - **并发去重**：同一张图被列表多次请求时只下载一次（`inflight`）。
 *
 * ⚠️ `registerSchemesAsPrivileged` **必须在 app ready 之前**调用，
 * 所以它写在模块顶层 —— 由 `index.ts` 顶部 import 触发，早于 `whenReady`。
 */
import { app, net, protocol } from 'electron'
import { createHash } from 'node:crypto'
import {
  closeSync,
  fsyncSync,
  mkdirSync,
  openSync,
  readFileSync,
  readdirSync,
  renameSync,
  rmSync,
  writeSync
} from 'node:fs'
import { dirname, extname, join } from 'node:path'

/** 渲染层拼 URL 用的 scheme，`src/shared/media/url.ts` 必须与之一致 */
export const MEDIA_SCHEME = 'snooker-media'

/** URL 里的 host 段，只是为了 `standard: true` 的 URL 解析，无实际含义 */
const MEDIA_HOST = 'media'

const BUCKET = 'images'

/**
 * 缓存目录名
 *
 * 与 `data-cache`（JSON 快照）分开：图片量大、清缓存时希望两者能独立处理，
 * 也避免 sweep 逻辑互相扫到对方。同样**不能叫 `cache`**，见 `store.ts` 的注释。
 */
const MEDIA_DIR_NAME = 'media-cache'

/** 单张图上限，防止异常响应把磁盘写满（真实图片平均 22 KB） */
const MAX_BYTES = 5 * 1024 * 1024

const EXT_PATTERN = /^\.(webp|png|jpe?g|gif)$/
const PATH_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._/-]*$/

const CONTENT_TYPES: Record<string, string> = {
  '.webp': 'image/webp',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif'
}

/** Supabase 项目地址，去掉尾部斜杠；缺失时 handler 直接返回 503（不抛，避免整窗白屏） */
const SUPABASE_URL = (import.meta.env.VITE_SUPABASE_URL ?? '').replace(/\/+$/, '')

protocol.registerSchemesAsPrivileged([
  {
    scheme: MEDIA_SCHEME,
    privileges: {
      standard: true,
      secure: true,
      supportFetchAPI: true,
      stream: true
    }
  }
])

function mediaDir(): string {
  return join(app.getPath('userData'), MEDIA_DIR_NAME)
}

/**
 * 相对路径 → 缓存文件绝对路径
 *
 * 调用前必须过 `safeRelativePath()`；这里只负责 hash 映射。
 */
function cacheFile(relativePath: string): string {
  const hash = createHash('sha1').update(relativePath).digest('hex')
  const ext = extname(relativePath).toLowerCase()
  return join(mediaDir(), `${hash}${EXT_PATTERN.test(ext) ? ext : '.bin'}`)
}

/**
 * 校验并归一化 URL 里的相对路径
 *
 * 渲染层传进来的是 Storage 里的对象路径（`balls/xxx.webp`）。这里挡三类东西：
 *   - 目录穿越（`..`）、反斜杠、空字节 —— 否则能读到缓存目录外的文件
 *   - 非白名单字符 —— 路径只该由字母数字和 `._-/` 组成
 *   - 空路径 / 超长路径
 */
function safeRelativePath(pathname: string): string | null {
  let decoded: string
  try {
    decoded = decodeURIComponent(pathname)
  } catch {
    return null
  }
  const relative = decoded.replace(/^\/+/, '')
  if (!relative || relative.length > 512) return null
  if (relative.includes('..') || relative.includes('\\') || relative.includes('\0')) return null
  if (!PATH_PATTERN.test(relative)) return null
  return relative
}

function contentTypeOf(relativePath: string): string {
  return CONTENT_TYPES[extname(relativePath).toLowerCase()] ?? 'application/octet-stream'
}

function readCached(file: string): Buffer | null {
  try {
    const buffer = readFileSync(file)
    return buffer.byteLength > 0 ? buffer : null
  } catch {
    // ENOENT（没缓存）/ 被占用 / 权限 —— 一律当"没有"，走下载分支
    return null
  }
}

/** 原子写：tmp + fsync + rename，写法与 `store.ts` 的 writeText 一致 */
function writeCached(file: string, data: Buffer): void {
  mkdirSync(dirname(file), { recursive: true })
  const tmp = `${file}.${process.pid}.tmp`

  const fd = openSync(tmp, 'w')
  try {
    writeSync(fd, data)
    fsyncSync(fd)
  } finally {
    closeSync(fd)
  }

  try {
    renameSync(tmp, file)
  } catch (error) {
    rmSync(tmp, { force: true })
    throw error
  }
}

function imageResponse(data: Buffer, relativePath: string): Response {
  return new Response(new Uint8Array(data), {
    status: 200,
    headers: {
      'Content-Type': contentTypeOf(relativePath),
      // 文件名是 uuid，同一路径不会换图；就算换了，本地缓存也已命中，
      // 这里只影响 Chromium 的内存缓存
      'Cache-Control': 'public, max-age=86400'
    }
  })
}

function errorResponse(status: number, message: string): Response {
  return new Response(message, {
    status,
    headers: { 'Content-Type': 'text/plain; charset=utf-8' }
  })
}

/** 下载中的请求，同一路径并发只发一次 */
const inflight = new Map<string, Promise<Buffer | null>>()

async function fetchAndStore(relativePath: string): Promise<Buffer | null> {
  if (!SUPABASE_URL) return null

  const remote = `${SUPABASE_URL}/storage/v1/object/public/${BUCKET}/${relativePath}`
  try {
    // 用 net.fetch 而不是 Node 的 fetch：它走 Chromium 网络栈，
    // 会继承系统代理设置（这台机器访问 Supabase 需要代理）
    const response = await net.fetch(remote)
    if (!response.ok) return null

    const buffer = Buffer.from(await response.arrayBuffer())
    if (buffer.byteLength === 0 || buffer.byteLength > MAX_BYTES) return null

    try {
      writeCached(cacheFile(relativePath), buffer)
    } catch {
      // 落盘失败不影响本次显示，下次再试
    }
    return buffer
  } catch {
    return null
  }
}

function loadImage(relativePath: string): Promise<Buffer | null> {
  const pending = inflight.get(relativePath)
  if (pending) return pending

  const task = fetchAndStore(relativePath).finally(() => inflight.delete(relativePath))
  inflight.set(relativePath, task)
  return task
}

async function handleMediaRequest(request: Request): Promise<Response> {
  if (!SUPABASE_URL) return errorResponse(503, '缺少 VITE_SUPABASE_URL')

  let url: URL
  try {
    url = new URL(request.url)
  } catch {
    return errorResponse(400, '非法地址')
  }
  if (url.host !== MEDIA_HOST) return errorResponse(400, '非法地址')

  const relativePath = safeRelativePath(url.pathname)
  if (!relativePath) return errorResponse(400, '非法路径')

  const cached = readCached(cacheFile(relativePath))
  if (cached) return imageResponse(cached, relativePath)

  const downloaded = await loadImage(relativePath)
  if (!downloaded) return errorResponse(404, '图片不存在')

  return imageResponse(downloaded, relativePath)
}

/** 清掉上次异常退出留下的 `.tmp` 残留（正常流程里一定被 rename 或删除） */
function sweepTmpFiles(): void {
  try {
    const dir = mediaDir()
    for (const entry of readdirSync(dir)) {
      if (entry.endsWith('.tmp')) rmSync(join(dir, entry), { force: true })
    }
  } catch {
    // 目录不存在（首次启动）—— 正常情况
  }
}

/** 注册协议。在主进程 `whenReady` 之后、创建窗口之前调用 */
export function registerMediaProtocol(): void {
  sweepTmpFiles()
  protocol.handle(MEDIA_SCHEME, handleMediaRequest)
}

/** 图片缓存目录（排查问题用，别在业务里依赖它） */
export function mediaCacheDirectory(): string {
  return mediaDir()
}
