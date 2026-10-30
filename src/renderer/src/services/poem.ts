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
 * ⚠️ CSP：`index.html` 的 `connect-src` 必须包含 `https://v1.jinrishici.com`，
 * 否则请求会被静默拦掉（控制台只有一条 CSP 报错，fetch 直接 reject）。
 */
export interface Poem {
  content: string
  author: string
  origin: string
}

const ENDPOINT = 'https://v1.jinrishici.com/all.json'
const TIMEOUT_MS = 4000

/** 兜底句子：接口失败 / 超时 / 返回格式变了都用这些 */
const FALLBACK_POEMS: readonly Poem[] = [
  { content: '莫愁前路无知己，天下谁人不识君。', author: '高适', origin: '别董大' },
  { content: '长风破浪会有时，直挂云帆济沧海。', author: '李白', origin: '行路难' },
  { content: '千磨万击还坚劲，任尔东西南北风。', author: '郑燮', origin: '竹石' },
  { content: '纸上得来终觉浅，绝知此事要躬行。', author: '陆游', origin: '冬夜读书示子聿' },
  { content: '博观而约取，厚积而薄发。', author: '苏轼', origin: '稼说送张琥' },
  { content: '不积跬步，无以至千里。', author: '荀子', origin: '劝学' }
]

/** 随机取一句兜底（每次启动略有变化，不至于每次看到同一句） */
export function pickFallbackPoem(): Poem {
  return FALLBACK_POEMS[Math.floor(Math.random() * FALLBACK_POEMS.length)]
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
 * 注意：不做重试。启动页多等 4 秒已经是上限，重试只会更慢。
 */
export async function fetchPoem(): Promise<Poem | null> {
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
