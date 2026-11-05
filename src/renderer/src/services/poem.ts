/**
 * 启动页诗句（2026-11-05 重写：在线 + 本地双模式）
 *
 * 数据源：诗泉 `https://poetry.palemoky.com/api/poems/random`
 *   - 免费、免注册、CORS 是 `*`，桌面端可以直接 fetch
 *   - `content` 是数组：诗是「一联一项」，词是「一个句群一项」（不是逐句）
 *   - 支持 `?type=五言绝句` 这类按体裁过滤
 *
 * 三条原则：
 *   1. **永不抛错**：拿不到就返回 null，调用方用本地缓存兜底，启动页不能白屏
 *   2. **不重试超过 2 次**：这个接口有频率限制（实测连续请求会被 Cloudflare 403），
 *      403/429 直接放弃，别把自己拉黑
 *   3. **本地优先给内容、在线只做替换**：先渲染本地句子，接口回来再换
 *
 * ⚠️ CSP：`index.html` 的 `connect-src` 必须包含 `https://poetry.palemoky.com`
 */
import { categoryByCode, pickLocalPoem } from './poemLibrary'

/** 一首诗（字段按诗泉接口扁平化后的结果） */
export interface Poem {
  title: string
  /** 作者名 */
  author: string
  /** 朝代名，可能为空（数据里偶有缺失） */
  dynasty: string
  /** 体裁名，如「五言绝句」「宋词」 */
  type: string
  /** 整首；一项可能是一联（诗）或一个句群（词） */
  content: string[]
}

const ENDPOINT = 'https://poetry.palemoky.com/api/poems/random'
const TIMEOUT_MS = 6000
const MAX_ATTEMPTS = 2
/** 上一次**看到**的诗：下次启动首屏直接用它（2026-11-05，A+G 方案） */
const LAST_KEY = 'snooker:poem:last'

/** 这首诗从哪来：接口 / 本地缓存 */
export type PoemSource = 'api' | 'local'

function normalize(raw: unknown): Poem | null {
  if (typeof raw !== 'object' || raw === null) return null
  const data = raw as {
    title?: unknown
    content?: unknown
    author?: { name?: unknown } | null
    dynasty?: { name?: unknown } | null
    type?: { name?: unknown } | null
  }

  const content = Array.isArray(data.content)
    ? data.content.map((line) => String(line).trim()).filter((line) => line.length > 0)
    : []
  if (content.length === 0) return null

  return {
    title: typeof data.title === 'string' && data.title.trim() ? data.title.trim() : '无题',
    author: typeof data.author?.name === 'string' ? data.author.name : '佚名',
    dynasty: typeof data.dynasty?.name === 'string' ? data.dynasty.name : '',
    type: typeof data.type?.name === 'string' ? data.type.name : '',
    content
  }
}

/**
 * 记住一首诗（含来源）
 *
 * 这是一个「下次启动才生效」的缓存：启动页首屏直接显示它，后台再悄悄换成新的 ——
 * 用户不会看到"先本地、后在线"的跳变（2026-11-05 A 方案）。
 */
export function rememberPoem(poem: Poem, source: PoemSource = 'api'): void {
  try {
    window.localStorage.setItem(LAST_KEY, JSON.stringify({ poem, source, at: Date.now() }))
  } catch {
    // localStorage 不可用（隐私模式等）不影响主流程
  }
}

/**
 * 取上次看到的诗
 *
 * 选了类别时只在「体裁匹配所选类别」时返回 —— 否则会出现"选了宋词却显示唐诗"。
 */
export function recallPoem(
  categories: readonly string[] = []
): { poem: Poem; source: PoemSource } | null {
  try {
    const raw = window.localStorage.getItem(LAST_KEY)
    if (!raw) return null
    const parsed = JSON.parse(raw) as { poem?: unknown; source?: unknown }
    const poem = normalize(parsed.poem)
    if (!poem) return null

    if (categories.length > 0) {
      const labels = categories
        .map((code) => categoryByCode(code)?.apiType)
        .filter((label): label is string => Boolean(label))
      if (!labels.includes(poem.type)) return null
    }

    return { poem, source: parsed.source === 'local' ? 'local' : 'api' }
  } catch {
    return null
  }
}

/** 从已选类别里随机挑一个（没选 = 不限，直接走随机） */
function pickApiType(categories: readonly string[]): string | null {
  const labels = categories
    .map((code) => categoryByCode(code)?.apiType)
    .filter((label): label is string => Boolean(label))
  if (labels.length === 0) return null
  return labels[Math.floor(Math.random() * labels.length)]
}

/**
 * 拉一首诗；失败返回 null（调用方用 `recallPoem` / `pickCachedPoem` 兜底）
 *
 * 403 / 429 是频率限制，**不重试**：继续打只会让恢复更慢。
 * 注意：这个函数**不写缓存**，由调用方决定要不要记住（启动页是"只缓存不显示"）。
 */
export async function fetchPoem(categories: readonly string[] = []): Promise<Poem | null> {
  const apiType = pickApiType(categories)
  const url = apiType ? `${ENDPOINT}?type=${encodeURIComponent(apiType)}` : ENDPOINT

  for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt += 1) {
    try {
      const response = await fetch(url, {
        signal: AbortSignal.timeout(TIMEOUT_MS),
        headers: { Accept: 'application/json' },
        cache: 'no-store'
      })
      // 限流 / 被 WAF 拦：直接放弃，别再打
      if (response.status === 403 || response.status === 429) return null
      if (!response.ok) continue

      const json: unknown = await response.json()
      const data = (json as { data?: unknown }).data
      const poem = normalize(data)
      if (poem) return poem
    } catch {
      // 超时 / 断网 / JSON 解析失败 —— 换一次再试，仍失败就走兜底
    }
  }
  return null
}

/** 本地兜底：按类别从内置缓存里挑一首 */
export function pickCachedPoem(categories: readonly string[] = []): Poem {
  return pickLocalPoem(categories)
}

/**
 * 按标点切成句
 *
 * 中文诗词里「一句」按停顿算（逗号也断句）：水调歌头是 19 句，
 * 只按句号/问号切会数成 9 —— 界面上写"全诗 N 句"要用前者才符合直觉。
 */
export function splitSentences(content: readonly string[]): string[] {
  const text = content.join('')
  const sentences: string[] = []
  let buffer = ''

  for (const char of text) {
    buffer += char
    if ('，。！？；：…、'.includes(char)) {
      sentences.push(buffer)
      buffer = ''
    }
  }
  if (buffer.trim()) sentences.push(buffer)
  return sentences.map((line) => line.trim()).filter(Boolean)
}
