<script setup lang="ts">
/**
 * 启动页
 *
 * 结构：整屏渐变背景 + 居中的标题 / 诗句 / 开始按钮。
 * 独立于 MainLayout（不在侧栏里），对应旧版 WPF 的 Splash。
 *
 * 三个关键行为：
 *   1. **先渲染兜底句子，再异步换真句**：接口 4 秒超时，期间界面是完整的，
 *      不会出现「空白等接口」的观感
 *   2. **淡出后跳转**：先加 `--leaving` 类跑 360ms 过渡，再 `router.replace`，
 *      否则页面会「啪」地切走
 *   3. **自动进入**（2026-11-04）：停留 N 秒（设置页可调，默认 10、最少 5）后
 *      自己进主页，按钮仍可提前点。秒数与诗句类别都记在本机偏好里
 */
import { onBeforeUnmount, onMounted, ref } from 'vue'
import { useRouter } from 'vue-router'
import { fetchPoem, pickFallbackPoem, type Poem } from '@renderer/services/poem'
import { START_PAGE_DEFAULT_SECONDS, type AppPreferences } from '@shared/types/system'

const router = useRouter()

const poem = ref<Poem>(pickFallbackPoem())
const leaving = ref(false)
/** 自动进入倒计时；0 = 不计时（点按钮才走） */
const remaining = ref(0)
/** 组件已卸载就不再改状态（接口回来时用户可能已经点走了） */
let disposed = false
let ticker: number | undefined

function stopTicker(): void {
  if (ticker !== undefined) {
    window.clearInterval(ticker)
    ticker = undefined
  }
}

function startCountdown(total: number): void {
  if (!Number.isFinite(total) || total <= 0 || disposed) return
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

onMounted(async () => {
  // 偏好读不到（老版本主进程 / IPC 没起来）就按默认值走，不能卡在启动页
  const prefs: AppPreferences | null = await window.api.system.prefs().catch(() => null)

  const categories = prefs?.startPage.poemCategories ?? []
  const remote = await fetchPoem(categories)
  if (!disposed && remote) poem.value = remote

  startCountdown(prefs?.startPage.autoEnterSeconds ?? START_PAGE_DEFAULT_SECONDS)
})

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
    <div class="start__glow" aria-hidden="true"></div>

    <div class="start__inner">
      <p class="start__eyebrow">2D SNOOKER</p>
      <h1 class="start__title">斯诺克走位教学</h1>
      <p class="start__subtitle">彩球 · 袋口 · 进袋方式 —— 一条一条讲清楚</p>

      <blockquote class="start__poem">
        <p class="start__line">{{ poem.content }}</p>
        <footer class="start__meta">—— {{ poem.author }}《{{ poem.origin }}》</footer>
      </blockquote>

      <button class="start__button" type="button" @click="start">开始</button>
      <!-- 自动进入的倒计时：让"页面自己会走"这件事可见，不然用户会以为卡住了 -->
      <p v-if="remaining > 0" class="start__countdown">{{ remaining }} 秒后自动进入主页</p>
    </div>
  </div>
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

.start--leaving {
  opacity: 0;
}

.start__inner {
  position: relative;
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 0.75rem;
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
  margin: 0;
  font-size: 2.75rem;
  font-weight: 400; /* 字体只有 Regular，用字号和字距撑气势，不用合成加粗 */
  letter-spacing: 0.08em;
  color: var(--text-1);
}

.start__subtitle {
  margin: 0;
  font-size: 0.9375rem;
  color: var(--text-2);
}

.start__poem {
  margin: 2.25rem 0 0.5rem;
  padding: 0;
}

.start__line {
  margin: 0;
  font-size: 1.375rem;
  line-height: 1.9;
  letter-spacing: 0.12em;
  color: var(--text-1);
}

.start__meta {
  margin-top: 0.875rem;
  font-size: 0.875rem;
  color: var(--text-2);
}

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

/* 倒计时：比按钮弱一档，别抢主体 */
.start__countdown {
  margin: 0.375rem 0 0;
  font-size: 0.8125rem;
  color: var(--text-3);
  font-variant-numeric: tabular-nums;
  letter-spacing: 0.04em;
}
</style>
