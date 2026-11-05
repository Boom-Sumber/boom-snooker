<script setup lang="ts">
/**
 * 启动页（2026-11-05 改版：诗笺卡 + 全诗浮层）
 *
 * 结构：整屏渐变 + 居中标题 / 诗笺卡 / 开始按钮。
 * 独立于 MainLayout（不在侧栏里），对应旧版 WPF 的 Splash。
 *
 * 四个关键行为：
 *   1. **本地先出内容，在线再替换**：进页面立刻用本地缓存渲染，接口回来再换；
 *      拿不到（断网 / 限流）就一直是本地那首，白屏是不会发生的
 *   2. **一句一行、首页最多 4 行**：接口的 content 一项是「一联」或「一个句群」，
 *      直接按项渲染，超出的收进「全诗」浮层
 *   3. **自动进入可关**：`manualEnter = true` 时不显示倒计时、不自动跳，只能点按钮；
 *      打开全诗浮层时倒计时暂停（正在读诗不该被跳走）
 *   4. **淡出后跳转**：先加 `--leaving` 跑 360ms 过渡，再 `router.replace`
 */
import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { useRouter } from 'vue-router'
import {
  fetchPoem,
  pickCachedPoem,
  recallPoem,
  rememberPoem,
  splitSentences,
  type Poem,
  type PoemSource
} from '@renderer/services/poem'
import { categoryByCode } from '@renderer/services/poemLibrary'
import { START_PAGE_DEFAULT_SECONDS, type AppPreferences } from '@shared/types/system'

const router = useRouter()

/** 首页最多显示几行（一项=一联/一句群） */
const PREVIEW_LINES = 4

/**
 * 首屏内容（2026-11-05 A+G 方案）
 *
 * **同步、零延迟、之后不再变**：优先用"上次看到的那首"（localStorage 同步读），
 * 没有才从本地缓存轮换一首。在线请求只在后台更新缓存，**下次启动才生效** ——
 * 这样用户永远不会看到"先本地、后在线"的跳变。
 */
const recalled = recallPoem()
const poem = ref<Poem>(recalled ? recalled.poem : pickCachedPoem())
/** 当前这首诗的来源（决定下次启动怎么取） */
const source = ref<PoemSource>(recalled ? recalled.source : 'local')
const leaving = ref(false)
const sheetOpen = ref(false)
/** 自动进入倒计时；0 = 不计时（手动模式或已停） */
const remaining = ref(0)
const manualEnter = ref(false)
/** 正在换一首：把诗句压暗、按钮禁用，避免连点 */
const loading = ref(false)
/** 用户选的体裁，换一首时要复用 */
const categories = ref<string[]>([])

let disposed = false
let ticker: number | undefined

const previewLines = computed(() => poem.value.content.slice(0, PREVIEW_LINES))
const hasMore = computed(() => poem.value.content.length > PREVIEW_LINES)
const sentenceCount = computed(() => splitSentences(poem.value.content).length)
const byline = computed(() => {
  const parts = [poem.value.dynasty, poem.value.author].filter(Boolean)
  return `—— ${parts.join(' · ')}《${poem.value.title}》`
})
const sheetMeta = computed(() => {
  const parts = [poem.value.dynasty, poem.value.author, poem.value.type].filter(Boolean)
  return `${parts.join(' · ')} · 共 ${sentenceCount.value} 句`
})
const showCountdown = computed(() => !manualEnter.value && remaining.value > 0)

function stopTicker(): void {
  if (ticker !== undefined) {
    window.clearInterval(ticker)
    ticker = undefined
  }
}

function startCountdown(total: number): void {
  stopTicker()
  if (manualEnter.value || !Number.isFinite(total) || total <= 0 || disposed) return
  remaining.value = total
  ticker = window.setInterval(() => {
    remaining.value -= 1
    if (remaining.value <= 0) {
      stopTicker()
      remaining.value = 0
      start()
    }
  }, 1000)
}

/** 浮层开着 = 暂停读秒（合上后从剩下的秒数继续） */
watch(sheetOpen, (open) => {
  if (open) stopTicker()
  else if (remaining.value > 0) startCountdown(remaining.value)
})

onMounted(async () => {
  // 偏好读不到（老版本主进程 / IPC 没起来）就按默认值走，不能卡在启动页
  const prefs: AppPreferences | null = await window.api.system.prefs().catch(() => null)
  const startPage = prefs?.startPage
  manualEnter.value = startPage?.manualEnter === true

  const selected = startPage?.poemCategories ?? []
  categories.value = selected

  // 用户改过体裁：当前这首不属于所选类别，就换成本地对应类别的一首
  // （只在挂载时可能发生一次，而且发生在首帧前后，用户基本看不到）
  if (selected.length > 0) {
    const allowed = selected
      .map((code) => categoryByCode(code)?.apiType)
      .filter((label): label is string => Boolean(label))
    if (!allowed.includes(poem.value.type)) {
      poem.value = pickCachedPoem(selected)
      source.value = 'local'
    }
  }

  // E：读秒**不等网络**。内容已经在首帧渲染好了，倒计时立刻开始，
  //    接口再慢（6 秒超时）也不影响"到点进主页"。
  startCountdown(startPage?.autoEnterSeconds ?? START_PAGE_DEFAULT_SECONDS)

  // 记住当前这首：下次启动首屏直接用它（G）
  rememberPoem(poem.value, source.value)

  // 后台取新诗：**只写缓存、不改当前画面**（A）。拿到的那首下次启动才出现。
  void warmUp()
})

/** 预热：拿到就存起来留给下次启动；拿不到（断网/限流）就算了，不影响当前画面 */
async function warmUp(): Promise<void> {
  const remote = await fetchPoem(categories.value)
  if (disposed || !remote) return
  rememberPoem(remote, 'api')
}

/**
 * 换一首（2026-11-05）
 *
 * 这是**用户主动操作**，等一下可以接受：先试在线，拿不到就从本地缓存换一首
 * **不同的**（轮换保证不重复），并记住它 —— 下次启动首屏就显示这首。
 */
async function nextPoem(): Promise<void> {
  if (loading.value || leaving.value) return
  loading.value = true
  try {
    const remote = await fetchPoem(categories.value)
    if (remote) {
      poem.value = remote
      source.value = 'api'
      rememberPoem(remote, 'api')
      return
    }

    const current = `${poem.value.title}|${poem.value.author}`
    for (let attempt = 0; attempt < 6; attempt += 1) {
      const candidate = pickCachedPoem(categories.value)
      if (`${candidate.title}|${candidate.author}` !== current) {
        poem.value = candidate
        source.value = 'local'
        rememberPoem(candidate, 'local')
        return
      }
    }
    // 缓存里只有一首时换不动，保持原样即可
  } finally {
    loading.value = false
  }
}

onBeforeUnmount(() => {
  disposed = true
  stopTicker()
})

function start(): void {
  if (leaving.value) return
  stopTicker()
  leaving.value = true
  // 与 CSS 的 .start--leaving 过渡时长保持一致
  window.setTimeout(() => {
    void router.replace({ name: 'home' })
  }, 360)
}
</script>

<template>
  <div class="start" :class="{ 'start--leaving': leaving }">
    <!-- 背景上的两团柔光：卡片是毛玻璃，得有东西可"糊" -->
    <div class="start__glow" aria-hidden="true"></div>
    <div class="start__blob start__blob--a" aria-hidden="true"></div>
    <div class="start__blob start__blob--b" aria-hidden="true"></div>

    <div class="start__inner">
      <p class="start__eyebrow">2D SNOOKER</p>
      <h1 class="start__title">斯诺克走位教学</h1>
      <p class="start__subtitle">彩球 · 袋口 · 进袋方式 —— 一条一条讲清楚</p>

      <!-- 诗笺卡：宽度跟着内容走，最多 4 行，超出给「全诗」 -->
      <figure class="poem">
        <div class="poem__card" :class="{ 'is-loading': loading }">
          <ul class="poem__lines">
            <li v-for="(line, index) in previewLines" :key="index">{{ line }}</li>
          </ul>
          <button v-if="hasMore" class="poem__more" type="button" @click="sheetOpen = true">
            全诗 {{ sentenceCount }} 句 <span aria-hidden="true">▾</span>
          </button>
          <!-- 右下角：换一首 -->
          <button class="poem__next" type="button" :disabled="loading" @click="nextPoem">
            换一首
          </button>
        </div>
        <figcaption class="poem__byline">{{ byline }}</figcaption>
      </figure>

      <button class="start__button" type="button" @click="start">开始</button>
      <p v-if="showCountdown" class="start__countdown">{{ remaining }} 秒后自动进入主页</p>
      <p v-else-if="manualEnter" class="start__countdown">看完点「开始」进入主页</p>
    </div>
  </div>

  <!-- 全诗浮层：标题在上方居中 -->
  <transition name="sheet">
    <div v-if="sheetOpen" class="sheet-mask" @click.self="sheetOpen = false">
      <div class="sheet" role="dialog" aria-modal="true">
        <h2 class="sheet__title">《{{ poem.title }}》</h2>
        <p class="sheet__meta">{{ sheetMeta }}</p>
        <div class="sheet__rule" aria-hidden="true"></div>
        <ul class="sheet__body">
          <li v-for="(line, index) in poem.content" :key="index">{{ line }}</li>
        </ul>
        <div class="sheet__actions">
          <button class="sheet__btn" type="button" :disabled="loading" @click="nextPoem">
            换一首
          </button>
          <button class="sheet__btn" type="button" @click="sheetOpen = false">合上</button>
        </div>
      </div>
    </div>
  </transition>
</template>

<style scoped>
.start {
  position: relative;
  display: grid;
  place-items: center;
  height: 100vh;
  overflow: hidden;
  background:
    radial-gradient(
      120% 90% at 15% 0%,
      color-mix(in srgb, var(--primary) 14%, transparent),
      transparent 60%
    ),
    radial-gradient(
      100% 80% at 85% 100%,
      color-mix(in srgb, var(--info) 12%, transparent),
      transparent 55%
    ),
    var(--bg);
  transition: opacity 0.36s ease;
}

/* 左上角一团柔和光斑，避免整屏纯色显得死板 */
.start__glow {
  position: absolute;
  top: -18vmax;
  left: -12vmax;
  width: 52vmax;
  height: 52vmax;
  background: radial-gradient(
    circle,
    color-mix(in srgb, var(--primary) 22%, transparent),
    transparent 62%
  );
  filter: blur(2vmax);
  pointer-events: none;
}

/* 卡片背后的两团色光：毛玻璃要糊住点什么才成立 */
.start__blob {
  position: absolute;
  border-radius: 50%;
  filter: blur(44px);
  opacity: 0.42;
  pointer-events: none;
}
.start__blob--a {
  top: 36%;
  left: calc(50% - 11rem);
  width: 13rem;
  height: 13rem;
  background: color-mix(in srgb, var(--primary) 34%, transparent);
}
.start__blob--b {
  top: 50%;
  left: calc(50% + 1rem);
  width: 11rem;
  height: 11rem;
  background: color-mix(in srgb, var(--info) 30%, transparent);
}

.start--leaving {
  opacity: 0;
}

.start__inner {
  position: relative;
  z-index: 1;
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 0.5rem;
  max-width: 46rem;
  padding: 0 2rem;
  text-align: center;
  transition:
    opacity 0.36s ease,
    transform 0.36s ease;
}

.start--leaving .start__inner {
  transform: translateY(-0.5rem);
}

.start__eyebrow {
  margin: 0;
  font-size: 0.75rem;
  letter-spacing: 0.32em;
  color: var(--text-3);
}

.start__title {
  margin: 0.625rem 0 0;
  font-size: 2.6rem;
  font-weight: 400; /* 字体只有 Regular，用字号和字距撑气势，不用合成加粗 */
  letter-spacing: 0.08em;
  color: var(--text-1);
}

.start__subtitle {
  margin: 0.5rem 0 0;
  font-size: 0.9375rem;
  color: var(--text-2);
}

/* ---------- 诗笺卡 ---------- */

.poem {
  position: relative;
  display: flex;
  flex-direction: column;
  width: fit-content;
  min-width: min(11rem, 100%);
  max-width: min(38rem, 100%);
  /* 给绝对定位的署名留位置：它不参与宽度计算，否则长标题会把卡片撑宽 */
  margin: 2.25rem 0 0;
  padding-bottom: 1.75rem;
}

.poem__card {
  position: relative;
  width: 100%;
  /* 底部多留一档：右下角要放「换一首」，不挤到诗句 */
  padding: 1.75rem 2.75rem 2.875rem;
  background: color-mix(in srgb, var(--surface) 56%, transparent);
  border: 1px solid color-mix(in srgb, var(--surface) 72%, transparent);
  border-radius: 16px;
  box-shadow:
    0 14px 44px rgb(0 0 0 / 9%),
    inset 0 1px 0 rgb(255 255 255 / 60%);
  backdrop-filter: blur(22px) saturate(150%);
  -webkit-backdrop-filter: blur(22px) saturate(150%);
  transition: opacity 0.2s ease;
}

/* 换一首进行中：诗句压暗，避免看起来"没反应" */
.poem__card.is-loading .poem__lines {
  opacity: 0.35;
}

.poem__lines {
  display: flex;
  flex-direction: column;
  gap: 0.1em;
  margin: 0;
  padding: 0;
  list-style: none;
  transition: opacity 0.2s ease;
}

.poem__lines li {
  font-size: 1.125rem;
  line-height: 2.15;
  letter-spacing: 0.1em;
  color: var(--text-1);
}

.poem__more {
  display: inline-flex;
  gap: 0.25rem;
  align-items: center;
  margin-top: 0.875rem;
  padding: 0.3125rem 0.875rem;
  font: inherit;
  font-size: 0.8125rem;
  color: var(--text-2);
  cursor: pointer;
  background: transparent;
  border: 1px solid var(--border);
  border-radius: 999px;
  transition:
    color var(--transition-fast),
    background-color var(--transition-fast),
    border-color var(--transition-fast);
}

.poem__more:hover {
  color: var(--primary);
  background: color-mix(in srgb, var(--primary) 7%, transparent);
  border-color: color-mix(in srgb, var(--primary) 40%, transparent);
}

/* 右下角「换一首」：无边框、比正文弱一档，不抢诗句 */
.poem__next {
  position: absolute;
  right: 1rem;
  bottom: 0.75rem;
  padding: 0.1875rem 0.5rem;
  font: inherit;
  font-size: 0.75rem;
  color: var(--text-3);
  cursor: pointer;
  background: transparent;
  border: 0;
  border-radius: 999px;
  transition:
    color var(--transition-fast),
    background-color var(--transition-fast);
}

.poem__next:hover:not(:disabled) {
  color: var(--primary);
  background: color-mix(in srgb, var(--primary) 7%, transparent);
}

.poem__next:disabled,
.sheet__btn:disabled {
  cursor: default;
  opacity: 0.5;
}

/* 署名靠右，与卡片右边缘严格对齐；超长标题在卡片宽度内省略 */
.poem__byline {
  position: absolute;
  right: 0;
  bottom: 0;
  left: 0;
  overflow: hidden;
  font-size: 0.875rem;
  line-height: 1.5;
  color: var(--text-2);
  text-align: right;
  letter-spacing: 0.04em;
  white-space: nowrap;
  text-overflow: ellipsis;
}

/* ---------- 按钮与倒计时 ---------- */

.start__button {
  margin-top: 2rem;
  padding: 0.6875rem 2.75rem;
  font-family: inherit;
  font-size: 1rem;
  letter-spacing: 0.16em;
  color: #fff;
  cursor: pointer;
  background: var(--primary);
  border: none;
  border-radius: 999px;
  box-shadow: 0 6px 20px color-mix(in srgb, var(--primary) 32%, transparent);
  transition:
    background-color var(--transition-fast),
    transform var(--transition-fast),
    box-shadow var(--transition-fast);
}

.start__button:hover {
  background: var(--primary-hover);
  box-shadow: 0 8px 26px color-mix(in srgb, var(--primary) 40%, transparent);
  transform: translateY(-1px);
}

.start__button:active {
  background: var(--primary-active);
  transform: translateY(0);
}

.start__button:focus-visible {
  outline: 2px solid var(--primary);
  outline-offset: 3px;
}

.start__countdown {
  margin: 0.5rem 0 0;
  font-size: 0.8125rem;
  color: var(--text-3);
  font-variant-numeric: tabular-nums;
  letter-spacing: 0.04em;
}

/* ---------- 全诗浮层 ---------- */

.sheet-mask {
  position: fixed;
  inset: 0;
  z-index: 30;
  display: grid;
  place-items: center;
  padding: 1.5rem;
  background: color-mix(in srgb, var(--bg) 55%, transparent);
  backdrop-filter: blur(6px);
}

.sheet {
  display: flex;
  flex-direction: column;
  width: min(40rem, 100%);
  max-height: min(74vh, 42rem);
  padding: 2.125rem 2.5rem;
  background: var(--surface);
  border: 1px solid var(--border);
  border-radius: 16px;
  box-shadow: 0 18px 50px rgb(0 0 0 / 18%);
}

.sheet__title {
  margin: 0;
  font-size: 1.1875rem;
  font-weight: 500;
  color: var(--text-1);
  text-align: center;
  letter-spacing: 0.1em;
}

.sheet__meta {
  margin: 0.375rem 0 0;
  font-size: 0.8125rem;
  color: var(--text-3);
  text-align: center;
  letter-spacing: 0.04em;
}

.sheet__rule {
  flex: 0 0 auto;
  width: 34px;
  height: 1px;
  margin: 1rem auto 1.125rem;
  background: var(--border);
}

.sheet__body {
  flex: 1 1 auto;
  min-height: 0;
  margin: 0;
  padding: 0 0.375rem;
  overflow-y: auto;
  text-align: center;
  list-style: none;
}

.sheet__body li {
  font-size: 1.0625rem;
  line-height: 2.1;
  color: var(--text-1);
  letter-spacing: 0.08em;
}

.sheet__actions {
  display: flex;
  flex: 0 0 auto;
  gap: 0.5rem;
  justify-content: center;
  margin-top: 1.25rem;
}

.sheet__btn {
  padding: 0.4375rem 1.125rem;
  font: inherit;
  font-size: 0.8125rem;
  color: var(--text-2);
  cursor: pointer;
  background: transparent;
  border: 1px solid var(--border);
  border-radius: 999px;
  transition:
    color var(--transition-fast),
    border-color var(--transition-fast);
}

.sheet__btn:hover {
  color: var(--text-1);
  border-color: var(--text-3);
}

.sheet-enter-active,
.sheet-leave-active {
  transition: opacity 0.22s ease;
}

.sheet-enter-from,
.sheet-leave-to {
  opacity: 0;
}
</style>
