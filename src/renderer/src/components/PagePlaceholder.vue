<script setup lang="ts">
/**
 * 简单占位页（现在只有 404 在用）
 *
 * 早期版本带过一个 `task` 属性，用来显示"这个页面计划在哪个任务里实现"，
 * 那是开发期的脚手架提示；页面全部实现完之后它就是纯噪音，已删（T9.4）。
 */
defineProps<{
  title: string
  description?: string
}>()
</script>

<template>
  <section class="placeholder">
    <h1>{{ title }}</h1>
    <p v-if="description" class="description">{{ description }}</p>
    <slot />
  </section>
</template>

<style scoped>
.placeholder {
  display: flex;
  flex-direction: column;
  gap: 0.75rem;
  min-height: 100%;
  padding: clamp(16px, 2.5vw, 32px);
}

h1 {
  margin: 0;
  color: var(--primary);
  font-size: clamp(1.125rem, 1.4vw, 1.375rem);
  font-weight: 500;
}

.description {
  margin: 0;
  color: var(--text-2);
  line-height: 1.8;
}
</style>
