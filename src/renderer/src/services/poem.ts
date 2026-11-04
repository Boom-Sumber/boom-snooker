/**
 * 启动页诗句
 *
 * 接口：`https://v1.jinrishici.com/all.json` → `{ content, origin, author, ... }`
 *
 * 三条原则：
 *   1. **永不抛错**：拿不到就返回 null，调用方继续显示兜底句子。
 *      启动页是用户看到的第一个画面，绝不能因为第三方接口挂了而白屏。
 *   2. **超时 4 秒**：这个接口在国外，慢的时候能拖十几秒；启动页不值得等。
 *   3. **兜底句子写在本地**：不依赖任何网络，也不依赖接口格式不变。
 *
 * 类别（2026-11-04）：在线接口不支持按类别取句，选了类别就用本地句库
 * （见 `poemLibrary.ts`）。不选类别才走在线推荐。
 *
 * ⚠️ CSP：`index.html` 的 `connect-src` 必须包含 `https://v1.jinrishici.com`，
 * 否则请求会被静默拦掉（控制台只有一条 CSP 报错，fetch 直接 reject）。
 */
import { poemsOf } from './poemLibrary'

export interface Poem {
  content: string
  author: string
  origin: string
}

const ENDPOINT = 'https://v1.jinrishici.com/all.json'
const TIMEOUT_MS = 4000

/** 随机取一句本地句子（可按类别过滤；不传就是全库） */
export function pickFallbackPoem(categories: readonly string[] = []): Poem {
  const pool = poemsOf(categories)
  return pool[Math.floor(Math.random() * pool.length)]
}

function isPoem(value: unknown): value is Poem {
  if (typeof value !== 'object' || value === null) return false
  const v = value as Partial<Poem>
  return (
    typeof v.content === 'string' &&
    v.content.trim().length > 0 &&
    typeof v.author === 'string' &&
    typeof v.origin === 'string'
  )
}

/**
 * 拉一句诗；失败返回 null（调用方保留兜底句子）
 *
 * `categories` 非空时直接用本地句库 —— 在线接口没有分类能力，
 * 硬拉一句不相关的回来反而是错的行为。
 *
 * 注意：不做重试。启动页多等 4 秒已经是上限，重试只会更慢。
 */
export async function fetchPoem(categories: readonly string[] = []): Promise<Poem | null> {
  if (categories.length > 0) return pickFallbackPoem(categories)

  try {
    const response = await fetch(ENDPOINT, {
      signal: AbortSignal.timeout(TIMEOUT_MS),
      // 接口支持 CORS，桌面端直接请求即可，不需要代理
      headers: { Accept: 'application/json' }
    })
    if (!response.ok) return null

    const data: unknown = await response.json()
    if (!isPoem(data)) return null

    return { content: data.content.trim(), author: data.author, origin: data.origin }
  } catch {
    // 超时 / 断网 / CSP 拦截 / JSON 解析失败 —— 一律静默降级
    return null
  }
}
