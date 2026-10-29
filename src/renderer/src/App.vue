<script setup lang="ts">
const appName = '斯诺克走位教学'
</script>

<template>
  <main class="placeholder">
    <h1>{{ appName }}</h1>
    <p>阶段 1 · 骨架已就位（T1.1）</p>
    <p class="hint">窗口外壳 / 主题 / 路由 将在 T1.2 ~ T1.4 落地</p>
  </main>
</template>

<style scoped>
.placeholder {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 0.5rem;
  height: 100%;
  font-family: var(--font-family-base, system-ui, sans-serif);
}

h1 {
  margin: 0;
  font-size: 1.75rem;
  font-weight: 600;
}

p {
  margin: 0;
  font-size: 0.9375rem;
  opacity: 0.75;
}

.hint {
  font-size: 0.8125rem;
  opacity: 0.5;
}
</style>
