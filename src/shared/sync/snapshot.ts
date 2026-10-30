/**
 * 全量快照同步
 *
 * 策略（D3）：本地存一份完整快照，启动时只比对 `dataset_version`，
 * 版本不同才重下全量。185 行 / 不到 200 KB，增量同步换不来任何收益。
 *
 * 关键行为：
 *   - **匿名即可同步**（D22）：`get_dataset_version` / `get_dataset_snapshot`
 *     都已 grant 给 anon，未登录也能拿到已发布数据
 *   - **失败绝不破坏现有缓存**：下载成功、校验通过之后才 `writeCache` 覆盖；
 *     断网 / 超时 / 返回结构异常都只返回状态，不动磁盘
 *   - **原子替换**：真正落盘由 `writeCache` 负责（temp + rename，见 T2.3）
 *
 * 缓存里**只放公共教学数据**。带隐私的东西（我的投稿、待审队列）不进缓存，
 * 按需查服务端 —— 见 `src/shared/storage/local.ts` 顶部注释。
 */
import type { Json } from '../types/db'
import type { Tables } from '../types/db'
import { supabase } from '../api/client'
import { CACHE_NAMES, peekCache, readCache, writeCache } from '../storage/local'

/** 一份完整快照（就是 `get_dataset_snapshot()` 返回的结构 + 本地写入时间） */
export interface DatasetSnapshot {
  /** 服务端的 `dataset_meta.version` */
  version: number
  balls: Tables<'balls'>[]
  advanced: Tables<'advanced'>[]
  dict: Tables<'display_dict'>[]
  /** 本地写入时间（毫秒），只用于 UI 显示"数据更新于" */
  savedAt: number
}

export type SyncStage = 'checking' | 'downloading' | 'saving' | 'done'

export interface SyncProgress {
  stage: SyncStage
  /** 可直接展示的中文文案 */
  message: string
}

export type SyncStatus =
  /** 拉到新版本并已落盘 */
  | 'updated'
  /** 版本一致，没下载 */
  | 'up-to-date'
  /** 连不上服务端，用的是本地缓存（可能为 null） */
  | 'offline'
  /** 服务端有响应但出错（结构异常 / RPC 报错） */
  | 'error'

export interface SyncResult {
  status: SyncStatus
  /** 同步后本地的版本号；完全没有数据时为 null */
  version: number | null
  /** 出错时的原因（已中文化），给 UI 用 */
  message?: string
}

/** 版本探测超时：只是查一个整数，慢到 10 秒基本等于断网 */
const VERSION_TIMEOUT_MS = 10_000
/** 全量下载超时：200 KB 在 3G 上也就几秒，给足余量 */
const SNAPSHOT_TIMEOUT_MS = 60_000

/** 结构校验：缓存被改坏 / 服务端返回异常时用来兜底 */
function isSnapshot(value: unknown): value is DatasetSnapshot {
  if (typeof value !== 'object' || value === null) return false
  const v = value as Partial<DatasetSnapshot>
  return (
    typeof v.version === 'number' &&
    Array.isArray(v.balls) &&
    Array.isArray(v.advanced) &&
    Array.isArray(v.dict)
  )
}

/** 读本地快照；没有或结构不对返回 null */
export async function readLocalDataset(): Promise<DatasetSnapshot | null> {
  return readCache<DatasetSnapshot>(CACHE_NAMES.dataset, isSnapshot)
}

/** 同步读内存里的快照（首帧用，不碰磁盘）；没有则 null */
export function peekLocalDataset(): DatasetSnapshot | null {
  return peekCache<DatasetSnapshot>(CACHE_NAMES.dataset)
}

/** 只查服务端版本号；失败抛错 */
async function fetchRemoteVersion(): Promise<number> {
  const { data, error } = await supabase
    .rpc('get_dataset_version')
    .abortSignal(AbortSignal.timeout(VERSION_TIMEOUT_MS))
  if (error) throw error
  if (typeof data !== 'number') throw new Error('版本号返回类型异常')
  return data
}

/** 拉全量快照；失败抛错 */
async function fetchRemoteSnapshot(): Promise<DatasetSnapshot> {
  const { data, error } = await supabase
    .rpc('get_dataset_snapshot')
    .abortSignal(AbortSignal.timeout(SNAPSHOT_TIMEOUT_MS))
  if (error) throw error

  // jsonb 回来是 unknown/Json，必须校验后再当结构用 —— 服务端函数被改动时
  // 这里会立刻暴露，而不是让脏数据流进缓存
  const raw = data as Json | null
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) {
    throw new Error('快照返回结构异常')
  }
  const snapshot = raw as unknown as Omit<DatasetSnapshot, 'savedAt'>
  if (!isSnapshot({ ...snapshot, savedAt: 0 })) {
    throw new Error('快照字段缺失')
  }
  return { ...snapshot, savedAt: Date.now() }
}

/** 网络类错误（超时 / 连不上）判定 —— 这类错误要降级成 offline，而不是 error */
function isNetworkError(error: unknown): boolean {
  if (!error || typeof error !== 'object') return false
  const name = (error as { name?: string }).name ?? ''
  const message = (error as { message?: string }).message ?? ''
  return (
    name === 'AbortError' ||
    name === 'TimeoutError' ||
    name === 'TypeError' || // fetch 网络层失败在浏览器里是 TypeError: Failed to fetch
    message.includes('Failed to fetch') ||
    message.includes('fetch failed') ||
    message.includes('NetworkError')
  )
}

function describeError(error: unknown): string {
  if (isNetworkError(error)) return '连不上服务器，先用本地数据'
  if (error && typeof error === 'object' && 'message' in error) {
    return String((error as { message: unknown }).message)
  }
  return '同步失败'
}

export interface SyncOptions {
  /** 忽略版本号，强制重下（"手动刷新"按钮用） */
  force?: boolean
  onProgress?: (progress: SyncProgress) => void
}

/**
 * 同步快照
 *
 * 永不抛错：所有失败都折成 `status`，调用方按状态决定 UI。
 * 这是有意的 —— 同步失败不该让列表页白屏，本地有缓存就继续用。
 */
export async function syncDataset(options: SyncOptions = {}): Promise<SyncResult> {
  const { force = false, onProgress } = options
  const report = (stage: SyncStage, message: string): void => onProgress?.({ stage, message })

  const local = await readLocalDataset()
  const localVersion = local?.version ?? null

  // ── 1. 比对版本 ──
  report('checking', '检查数据版本…')
  let remoteVersion: number
  try {
    remoteVersion = await fetchRemoteVersion()
  } catch (error) {
    return {
      status: isNetworkError(error) ? 'offline' : 'error',
      version: localVersion,
      message: describeError(error)
    }
  }

  if (!force && local && local.version === remoteVersion) {
    report('done', '已是最新')
    return { status: 'up-to-date', version: localVersion }
  }

  // ── 2. 下载全量 ──
  report('downloading', localVersion === null ? '首次同步，正在下载数据…' : '发现新版本，正在下载…')
  let snapshot: DatasetSnapshot
  try {
    snapshot = await fetchRemoteSnapshot()
  } catch (error) {
    // 关键：这里**不动本地缓存**，断网时用户照常看旧数据
    return {
      status: isNetworkError(error) ? 'offline' : 'error',
      version: localVersion,
      message: describeError(error)
    }
  }

  // ── 3. 落盘（原子替换） ──
  report('saving', '正在写入本地缓存…')
  try {
    await writeCache(CACHE_NAMES.dataset, snapshot)
  } catch (error) {
    return { status: 'error', version: localVersion, message: describeError(error) }
  }

  report('done', '数据已更新')
  return { status: 'updated', version: snapshot.version }
}

/**
 * 保证有数据可用：本地有就直接返回，没有才同步
 *
 * 给 T2.5 的 dataset store 用 —— 首屏不该等网络。
 */
export async function ensureDataset(
  onProgress?: (progress: SyncProgress) => void
): Promise<DatasetSnapshot | null> {
  const local = await readLocalDataset()
  if (local) return local
  await syncDataset({ onProgress })
  return readLocalDataset()
}
