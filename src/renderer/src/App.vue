<script setup lang="ts">
import { computed } from 'vue'
import type { ThemeMode } from '@shared/types/theme'
import { setThemeMode, themeIsDark, themeMode } from './theme'

const modes: { value: ThemeMode; label: string }[] = [
  { value: 'system', label: '跟随系统' },
  { value: 'light', label: '亮色' },
  { value: 'dark', label: '暗色' }
]

const swatches = [
  { token: '--primary', label: '主色' },
  { token: '--primary-active', label: '按下' },
  { token: '--success', label: '成功' },
  { token: '--warning', label: '警告' },
  { token: '--danger', label: '危险' },
  { token: '--info', label: '信息' }
]

const effectiveLabel = computed(() => (themeIsDark.value ? 'dark' : 'light'))
</script>

<template>
  <main class="stage">
    <section class="panel">
      <h1>主题系统自检（T1.2）</h1>
      <p class="meta">
        选择：<strong>{{ themeMode }}</strong> · 实际生效：<strong>{{ effectiveLabel }}</strong>
      </p>

      <div class="modes">
        <button
          v-for="item in modes"
          :key="item.value"
          :data-mode="item.value"
          :class="{ active: themeMode === item.value }"
          type="button"
          @click="setThemeMode(item.value)"
        >
          {{ item.label }}
        </button>
      </div>

      <div class="swatches">
        <div v-for="item in swatches" :key="item.token" class="swatch">
          <span class="chip" :style="{ background: `var(${item.token})` }" />
          <span class="chip-label">{{ item.label }}</span>
        </div>
      </div>

      <div class="sample">
        <div class="surface">surface（卡片底）</div>
        <div class="surface-2">surface-2（次级区块）</div>
        <p class="text-2">text-2：次级文本（作者、时间）</p>
        <p class="text-3">text-3：提示文本</p>
        <p class="long-text">
          长文本示例：半台一库翻袋，力度满力，注意低杆补偿，白球吃库后走位到中袋附近，出杆要稳，不要发力过猛。
        </p>
      </div>

      <p class="hint">T1.4 做布局时这块会被替换掉</p>
    </section>
  </main>
</template>

<style scoped>
.stage {
  display: flex;
  align-items: center;
  justify-content: center;
  min-height: 100%;
  padding: clamp(16px, 3vw, 40px);
}

.panel {
  width: 100%;
  max-width: 720px;
  padding: clamp(16px, 2.5vw, 32px);
  background: var(--surface);
  border: 1px solid var(--border);
  border-radius: var(--radius-lg);
  box-shadow: var(--shadow-1);
}

h1 {
  margin: 0 0 0.5rem;
  font-size: var(--font-size-lg);
  font-weight: 600;
}

.meta {
  margin: 0 0 1.25rem;
  color: var(--text-2);
  font-size: var(--font-size-sm);
}

.meta strong {
  color: var(--primary);
  font-weight: 600;
}

.modes {
  display: flex;
  gap: 0.5rem;
  margin-bottom: 1.5rem;
}

.modes button {
  padding: 0.5rem 1rem;
  font-family: inherit;
  font-size: var(--font-size-sm);
  color: var(--text-1);
  background: var(--surface-2);
  border: 1px solid var(--border);
  border-radius: var(--radius-sm);
  cursor: pointer;
  transition:
    background-color var(--transition-fast),
    color var(--transition-fast),
    border-color var(--transition-fast);
}

.modes button:hover {
  border-color: var(--primary);
  color: var(--primary);
}

.modes button.active {
  color: #fff;
  background: var(--primary-active);
  border-color: var(--primary-active);
}

.swatches {
  display: flex;
  flex-wrap: wrap;
  gap: 0.75rem;
  margin-bottom: 1.5rem;
}

.swatch {
  display: flex;
  align-items: center;
  gap: 0.375rem;
}

.chip {
  width: 1.5rem;
  height: 1.5rem;
  border: 1px solid var(--border);
  border-radius: var(--radius-sm);
}

.chip-label {
  color: var(--text-2);
  font-size: var(--font-size-sm);
}

.sample {
  display: flex;
  flex-direction: column;
  gap: 0.5rem;
  margin-bottom: 1.25rem;
}

.surface,
.surface-2 {
  padding: 0.75rem 1rem;
  border: 1px solid var(--border);
  border-radius: var(--radius-md);
}

.surface {
  background: var(--bg);
}

.surface-2 {
  background: var(--surface-2);
}

.sample p {
  margin: 0;
}

.text-2 {
  color: var(--text-2);
  font-size: var(--font-size-sm);
}

.text-3 {
  color: var(--text-3);
  font-size: var(--font-size-sm);
}

.hint {
  margin: 0;
  color: var(--text-3);
  font-size: var(--font-size-sm);
}
</style>
