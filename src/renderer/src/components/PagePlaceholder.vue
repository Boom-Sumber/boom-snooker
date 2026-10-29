<script setup lang="ts">
defineProps<{
  title: string
  description?: string
  /** 这个页面计划在哪个任务里实现 */
  task?: string
}>()
</script>

<template>
  <section class="placeholder">
    <h1>{{ title }}</h1>
    <p v-if="description" class="description">{{ description }}</p>
    <p v-if="task" class="task">{{ task }}</p>
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

.task {
  margin: 0;
  color: var(--text-3);
  font-size: var(--font-size-sm);
}
</style>
