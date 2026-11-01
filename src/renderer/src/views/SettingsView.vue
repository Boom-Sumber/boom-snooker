<script setup lang="ts">
/**
 * 系统设置（T3.7）
 *
 * 三块：主题 / 数据同步 / 版本与关于。
 *
 * 「关于」不再单独开页（旧版有，新版并入这里）—— 版本号、运行时版本、
 * 作者联系方式都属于"看一眼就行"的信息，单独一页反而多一次点击。
 *
 * 版本号从主进程 `app:info` 拿，不写死：写死的话每次发版都要改代码。
 */
import { onMounted, ref } from 'vue'
import { ElMessage } from 'element-plus'
import { storeToRefs } from 'pinia'
import { useDatasetStore, useThemeStore } from '@renderer/stores'
import type { AppInfo } from '@shared/types/app'
import type { ThemeMode } from '@shared/types/theme'

const theme = useThemeStore()
const dataset = useDatasetStore()
const { balls, advanced, version, lastSyncAt, syncing, progress, syncState } = storeToRefs(dataset)

const appInfo = ref<AppInfo | null>(null)
const syncingNow = ref(false)

const THEME_OPTIONS: { value: ThemeMode; label: string; hint: string }[] = [
  { value: 'light', label: '亮色', hint: '白天用' },
  { value: 'dark', label: '暗色', hint: '夜里不刺眼' },
  { value: 'system', label: '跟随系统', hint: '系统切了这里也跟着切' }
]

function formatTime(raw: number | null): string {
  if (!raw) return '—'
  const date = new Date(raw)
  if (Number.isNaN(date.getTime())) return '—'
  const pad = (n: number): string => String(n).padStart(2, '0')
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())} ${pad(date.getHours())}:${pad(date.getMinutes())}`
}

/** 同步状态 → 一句人话 */
function syncStateText(): string {
  if (syncingNow.value) return progress.value?.message ?? '同步中…'
  switch (syncState.value) {
    case 'updated':
      return '已更新到最新'
    case 'up-to-date':
      return '已是最新'
    case 'offline':
      return '连不上服务器，当前显示的是本地缓存'
    case 'error':
      return '同步出错，稍后再试'
    default:
      return '还没同步过'
  }
}

async function onSync(): Promise<void> {
  if (syncingNow.value) return
  syncingNow.value = true
  try {
    const state = await dataset.sync(true)
    if (state === 'updated') ElMessage.success('已更新到最新数据')
    else if (state === 'up-to-date') ElMessage.info('已经是最新版本')
    else if (state === 'offline') ElMessage.warning('连不上服务器，仍显示本地缓存')
    else ElMessage.error('同步失败，稍后再试')
  } finally {
    syncingNow.value = false
  }
}

async function onThemeChange(mode: ThemeMode): Promise<void> {
  await theme.setMode(mode)
}

onMounted(async () => {
  try {
    appInfo.value = await window.api.app.info()
  } catch {
    appInfo.value = null
  }
})
</script>

<template>
  <section class="settings">
    <h1 class="settings__title">系统设置</h1>

    <!-- 主题 -->
    <article class="card block">
      <h2 class="block__title">主题</h2>
      <p class="block__hint">切换立即生效，不需要重启。</p>

      <el-radio-group :model-value="theme.mode" @change="onThemeChange">
        <el-radio-button v-for="option in THEME_OPTIONS" :key="option.value" :value="option.value">
          {{ option.label }}
        </el-radio-button>
      </el-radio-group>
      <p class="block__hint">
        {{ THEME_OPTIONS.find((item) => item.value === theme.mode)?.hint }}
      </p>
    </article>

    <!-- 数据同步 -->
    <article class="card block">
      <h2 class="block__title">数据同步</h2>
      <p class="block__hint">数据存在本地，断网也能查；这里只是主动拉一次最新的。</p>

      <dl class="facts">
        <div class="fact">
          <dt>快照版本</dt>
          <dd>{{ version ? `v${version}` : '—' }}</dd>
        </div>
        <div class="fact">
          <dt>上次同步</dt>
          <dd>{{ formatTime(lastSyncAt) }}</dd>
        </div>
        <div class="fact">
          <dt>本地数据</dt>
          <dd>{{ balls.length }} 条彩球 · {{ advanced.length }} 条进阶</dd>
        </div>
      </dl>

      <div class="block__actions">
        <el-button type="primary" :loading="syncingNow || syncing" @click="onSync">
          立即同步
        </el-button>
        <span class="block__state">{{ syncStateText() }}</span>
      </div>
    </article>

    <!-- 版本与关于 -->
    <article class="card block">
      <h2 class="block__title">版本与关于</h2>

      <dl class="facts">
        <div class="fact">
          <dt>应用版本</dt>
          <dd>{{ appInfo?.version ?? '—' }}</dd>
        </div>
        <div class="fact">
          <dt>Electron</dt>
          <dd>{{ appInfo?.electron ?? '—' }}</dd>
        </div>
        <div class="fact">
          <dt>Chromium</dt>
          <dd>{{ appInfo?.chrome ?? '—' }}</dd>
        </div>
        <div class="fact">
          <dt>Node</dt>
          <dd>{{ appInfo?.node ?? '—' }}</dd>
        </div>
      </dl>

      <p class="about">
        作者：酸菜黄花鱼 · 联系方式 QQ 78260590<br />
        本程序用于学习 2D 桌球（斯诺克）走位技巧，不是外挂。
      </p>
    </article>
  </section>
</template>

<style scoped>
.settings {
  display: flex;
  flex-direction: column;
  gap: 0.875rem;
  padding: clamp(16px, 2.2vw, 28px);
}

.settings__title {
  margin: 0;
  font-size: clamp(1.25rem, 1.6vw, 1.5rem);
  font-weight: 500;
  color: var(--text-1);
}

.block {
  padding: clamp(1rem, 1.8vw, 1.5rem);
}

.block__title {
  margin: 0;
  font-size: var(--font-size-lg);
  font-weight: 500;
  color: var(--text-1);
}

.block__hint {
  margin: 0.375rem 0 0;
  font-size: var(--font-size-sm);
  line-height: 1.8;
  color: var(--text-3);
}

.facts {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(10rem, 1fr));
  gap: 0.75rem 1.5rem;
  margin: 1rem 0 0;
}

.fact {
  display: flex;
  flex-direction: column;
  gap: 0.125rem;
}

.fact dt {
  font-size: var(--font-size-sm);
  color: var(--text-3);
}

.fact dd {
  margin: 0;
  font-size: var(--font-size-sm);
  font-variant-numeric: tabular-nums;
  color: var(--text-1);
}

.block__actions {
  display: flex;
  gap: 0.75rem;
  align-items: center;
  margin-top: 1rem;
}

.block__state {
  font-size: var(--font-size-sm);
  color: var(--text-2);
}

.about {
  margin: 1rem 0 0;
  font-size: var(--font-size-sm);
  line-height: 2;
  color: var(--text-2);
}
</style>
