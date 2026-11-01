<script setup lang="ts">
/**
 * 首页（T3.6 / D31）
 *
 * 三段内容里**只保留两段**：声明 + 技术要点。
 * 旧版的「主播推广 / 抖音外链」按用户要求砍掉（2026-11-01），
 * 所以这页没有外链、没有二维码，纯文案 + 本地数据概览。
 *
 * 文案来源有两级（D31）：
 *   ① 快照里的 `content`（`site_sections` / `site_points`，超管在「文案管理」页在线改）
 *   ② 拿不到（首次启动没网 / 旧缓存）就回落到 `content/home.ts` 的内置文案
 *
 * 这样既能在线改文案，又不会因为断网让首页开天窗。
 */
import { computed } from 'vue'
import { storeToRefs } from 'pinia'
import { HOME_SECTIONS } from '@renderer/content/home'
import { useDatasetStore } from '@renderer/stores'

const dataset = useDatasetStore()
const { balls, advanced, version, lastSyncAt, content } = storeToRefs(dataset)

interface ViewSection {
  key: string
  title: string
  intro?: string
  points: { label?: string; text: string }[]
}

/** 数据库文案 → 视图结构；空则回落到内置文案 */
const sections = computed<ViewSection[]>(() => {
  const fromDb = content.value.filter((item) => item.title?.trim())
  if (fromDb.length === 0) return HOME_SECTIONS

  return fromDb.map((item) => ({
    key: item.key,
    title: item.title,
    intro: item.intro ?? undefined,
    points: (item.points ?? []).map((point) => ({
      label: point.label ?? undefined,
      text: point.body
    }))
  }))
})

/** `savedAt` 存的是毫秒时间戳（不是 ISO 字符串），这里统一按 Date 处理 */
function formatSync(raw: number | null): string {
  if (!raw) return '—'
  const date = new Date(raw)
  if (Number.isNaN(date.getTime())) return '—'
  const pad = (n: number): string => String(n).padStart(2, '0')
  return `${pad(date.getMonth() + 1)}-${pad(date.getDate())} ${pad(date.getHours())}:${pad(date.getMinutes())}`
}

/** 概览：数字说话，让用户一眼知道本地有多少东西可查 */
const stats = computed(() => [
  { value: String(balls.value.length || '—'), label: '彩球打法' },
  { value: String(advanced.value.length || '—'), label: '进阶系列' },
  { value: version.value ? `v${version.value}` : '—', label: '数据版本' },
  { value: formatSync(lastSyncAt.value), label: '上次同步' }
])
</script>

<template>
  <section class="home">
    <header class="card hero">
      <h1 class="hero__title">斯诺克走位教学</h1>
      <p class="hero__sub">
        彩球打法与进阶系列，按颜色、袋口、系列索引；数据存在本地，断网也能查。
      </p>

      <ul class="hero__stats">
        <li v-for="item in stats" :key="item.label" class="stat">
          <span class="stat__value">{{ item.value }}</span>
          <span class="stat__label">{{ item.label }}</span>
        </li>
      </ul>
    </header>

    <div class="sections">
      <article v-for="section in sections" :key="section.key" class="card section">
        <h2 class="section__title">{{ section.title }}</h2>
        <p v-if="section.intro" class="section__intro">{{ section.intro }}</p>

        <ul class="points">
          <li v-for="(point, index) in section.points" :key="index" class="point">
            <span v-if="point.label" class="point__label">{{ point.label }}</span>
            <span class="point__text">{{ point.text }}</span>
          </li>
        </ul>
      </article>
    </div>
  </section>
</template>

<style scoped>
.home {
  display: flex;
  flex-direction: column;
  gap: 0.875rem;
  padding: clamp(16px, 2.2vw, 28px);
}

.hero {
  padding: clamp(1.25rem, 2.2vw, 2rem);
  background:
    linear-gradient(135deg, color-mix(in srgb, var(--primary) 10%, transparent), transparent 62%),
    var(--surface-1);
}

.hero__title {
  margin: 0;
  font-size: clamp(1.375rem, 2vw, 1.75rem);
  font-weight: 500;
  color: var(--text-1);
}

.hero__sub {
  margin: 0.5rem 0 0;
  font-size: var(--font-size-sm);
  line-height: 1.8;
  color: var(--text-2);
}

.hero__stats {
  display: flex;
  flex-wrap: wrap;
  gap: clamp(1rem, 3vw, 2.5rem);
  margin: 1.25rem 0 0;
  padding: 0;
  list-style: none;
}

.stat {
  display: flex;
  flex-direction: column;
  gap: 0.125rem;
}

.stat__value {
  font-size: clamp(1.125rem, 1.6vw, 1.375rem);
  font-variant-numeric: tabular-nums;
  color: var(--primary);
}

.stat__label {
  font-size: var(--font-size-sm);
  color: var(--text-3);
}

/* 两段文案并排；窄窗口自动落成单列 */
.sections {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(22rem, 1fr));
  gap: 0.875rem;
  /* 按内容自然收口：两段字数差得多，强行等高会在短的那张下面留一大片空白 */
  align-items: start;
}

.section {
  padding: clamp(1rem, 1.8vw, 1.5rem);
}

.section__title {
  margin: 0;
  font-size: var(--font-size-lg);
  font-weight: 500;
  color: var(--text-1);
}

.section__intro {
  margin: 0.375rem 0 0;
  font-size: var(--font-size-sm);
  line-height: 1.8;
  color: var(--text-3);
}

.points {
  display: flex;
  flex-direction: column;
  gap: 0.875rem;
  margin: 1rem 0 0;
  padding: 0;
  list-style: none;
}

.point {
  display: flex;
  gap: 0.625rem;
  align-items: baseline;
  font-size: var(--font-size-sm);
  line-height: 1.9;
  color: var(--text-2);
}

/* 标签做成固定宽度的小胶囊，多行文字自动对齐到右边一列 */
.point__label {
  flex: none;
  min-width: 4.75rem;
  padding: 0 0.5rem;
  font-size: var(--font-size-sm);
  line-height: 1.7;
  color: var(--text-1);
  text-align: center;
  background: var(--surface-2);
  border-radius: var(--radius-sm);
}

.point__text {
  min-width: 0;
}
</style>
