/**
 * 图片缓存接口（T10.3）
 *
 * 图片平时是"打开到哪张下哪张"（`snooker-media://` 协议按需下载）；
 * 这里给一个"一次性全量缓存"的入口，以及缓存目录的统计 / 清空。
 */
export interface MediaCacheStats {
  /** 缓存目录里的文件数 */
  files: number
  /** 占用字节数 */
  bytes: number
}

export interface PrefetchProgress {
  /** 本次要去重的总张数 */
  total: number
  /** 已处理（下载 + 跳过 + 失败） */
  done: number
  /** 本次新下载 */
  downloaded: number
  /** 本地已有，直接跳过 */
  skipped: number
  /** 下载失败（断网 / 404 / 超过大小上限） */
  failed: number
}

export interface PrefetchResult extends PrefetchProgress {
  /** 是否被用户中途取消（已下载的会保留） */
  cancelled: boolean
}

export interface MediaApi {
  /** 当前缓存目录的文件数与体积 */
  stats: () => Promise<MediaCacheStats>
  /** 全量缓存；进度通过 `onProgress` 推送，返回值是最终统计 */
  prefetch: (paths: string[]) => Promise<{ ok: boolean; data?: PrefetchResult; message?: string }>
  /** 请求取消（已下载的保留，未开始的不再下） */
  cancelPrefetch: () => Promise<void>
  /** 清空缓存目录，返回清空后的统计（应为 0） */
  clear: () => Promise<MediaCacheStats>
  /** 订阅进度；返回取消订阅函数 */
  onProgress: (callback: (progress: PrefetchProgress) => void) => () => void
}
