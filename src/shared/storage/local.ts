/**
 * 本地缓存（业务层）—— 快照 JSON 的读写入口
 *
 * 分工：
 *   - `src/main/store.ts`：真正碰磁盘（`<userData>/cache/<name>.json`，原子 rename）
 *   - 本文件：给渲染进程用的封装 —— 类型校验、**内存缓存**、JSON 解析容错
 *
 * 为什么要有内存缓存：
 *   列表页滚动 / 切页会反复读同一份快照。每次走 IPC + `JSON.parse` 1 MB，
 *   在慢盘上能明显卡一下。首次读完就留在内存里，后续直接返回同一个对象。
 *
 * 为什么缓存**不按账号区分**（D22 的直接后果）：
 *   教学数据是匿名可读的公共内容，未登录也能同步。按账号分目录会导致
 *   换个人登录要重下一遍 6.7 MB 图片索引，没有任何收益。
 *   带隐私的东西（"我的投稿"、"待审队列"）**不进缓存**，按需查服务端。
 */
import type { CacheFileInfo } from '../types/storage'

/** 已知的缓存名（新增缓存必须登记，避免拼错字符串） */
export const CACHE_NAMES = {
  /** 全量数据快照：balls / advanced / dict / version */
  dataset: 'dataset'
} as const

export type CacheName = (typeof CACHE_NAMES)[keyof typeof CACHE_NAMES]

interface StoreBridge {
  read(name: string): Promise<string | null>
  write(name: string, content: string): Promise<void>
  remove(name: string): Promise<void>
  stat(name: string): Promise<CacheFileInfo | null>
}

function bridge(): StoreBridge | null {
  const holder = globalThis as { api?: { store?: StoreBridge } }
  return holder.api?.store ?? null
}

/**
 * 内存缓存
 *
 * 存的是**解析后的对象**（不是字符串），所以调用方拿到的引用是共享的 ——
 * 不要就地改它，要改就 `writeCache` 一份新的。Pinia store 里用 computed 派生。
 */
const memory = new Map<string, unknown>()

/** 同步读内存（首帧渲染用）；没有则 null，调用方应随后 await `readCache` */
export function peekCache<T>(name: CacheName): T | null {
  return (memory.get(name) as T | undefined) ?? null
}

/** 清空内存缓存（同步完成后替换、或调试用）；不删磁盘文件 */
export function clearMemoryCache(name?: CacheName): void {
  if (name) {
    memory.delete(name)
  } else {
    memory.clear()
  }
}

/**
 * 读缓存
 *
 * @param name 缓存名（见 `CACHE_NAMES`）
 * @param validate 可选校验器：数据结构变了 / 文件被改坏时返回 false，按"无缓存"处理
 * @returns 解析后的对象；没有缓存、解析失败、校验不过都返回 null
 */
export async function readCache<T>(
  name: CacheName,
  validate?: (value: unknown) => value is T
): Promise<T | null> {
  const cached = memory.get(name)
  if (cached !== undefined) {
    // 内存命中也过一遍校验：同一份缓存可能被不同调用方用不同校验器读，
    // 跳过校验会让"传错校验器"这种 bug 静默通过。类型守卫本身是 O(1) 的 typeof 判断
    if (validate && !validate(cached)) {
      console.warn(`[storage] 内存缓存 ${name} 结构不符合预期，按无缓存处理`)
      return null
    }
    return cached as T
  }

  const store = bridge()
  if (!store) return null // 主进程 / 测试环境：没有桥接就当没缓存

  const raw = await store.read(name)
  if (raw === null) return null

  let parsed: unknown
  try {
    parsed = JSON.parse(raw)
  } catch (error) {
    console.warn(`[storage] 缓存 ${name} 解析失败，按无缓存处理：`, error)
    return null
  }

  if (validate && !validate(parsed)) {
    console.warn(`[storage] 缓存 ${name} 结构不符合预期，按无缓存处理`)
    return null
  }

  memory.set(name, parsed)
  return parsed as T
}

/**
 * 写缓存（原子替换）
 *
 * 写成功后内存里放的是**同一个对象**，所以调用方写完后应把它当作只读。
 */
export async function writeCache<T>(name: CacheName, value: T): Promise<void> {
  const store = bridge()
  if (!store) {
    // 没有桥接时只更新内存，保证本进程内读得到
    memory.set(name, value)
    return
  }
  await store.write(name, JSON.stringify(value))
  memory.set(name, value)
}

/** 删缓存（磁盘 + 内存） */
export async function removeCache(name: CacheName): Promise<void> {
  memory.delete(name)
  const store = bridge()
  if (store) await store.remove(name)
}

/** 缓存文件信息（大小 / 修改时间）；没有文件返回 null */
export async function cacheInfo(name: CacheName): Promise<CacheFileInfo | null> {
  const store = bridge()
  if (!store) return null
  return store.stat(name)
}
