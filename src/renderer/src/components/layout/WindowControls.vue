<script setup lang="ts">
import { onBeforeUnmount, onMounted, ref } from 'vue'
import AppIcon from '@renderer/components/AppIcon.vue'

const { minimize, toggleMaximize, close, isMaximized: queryMaximized } = window.api.windowControls

const isMaximized = ref(false)
let unsubscribe: (() => void) | null = null

onMounted(async () => {
  isMaximized.value = await queryMaximized()
  unsubscribe = window.api.windowControls.onMaximizeChanged((value) => {
    isMaximized.value = value
  })
})

onBeforeUnmount(() => {
  unsubscribe?.()
  unsubscribe = null
})
</script>

<template>
  <div class="window-controls">
    <button class="ctl" type="button" aria-label="最小化" title="最小化" @click="minimize">
      <AppIcon name="minimize" size="0.875rem" />
    </button>

    <button
      class="ctl"
      type="button"
      :aria-label="isMaximized ? '还原' : '最大化'"
      :title="isMaximized ? '还原' : '最大化'"
      :data-maximized="isMaximized"
      @click="toggleMaximize"
    >
      <AppIcon :name="isMaximized ? 'restore' : 'maximize'" size="0.875rem" />
    </button>

    <button class="ctl ctl--close" type="button" aria-label="关闭" title="关闭" @click="close">
      <AppIcon name="close" size="0.875rem" />
    </button>
  </div>
</template>

<style scoped>
.window-controls {
  display: flex;
  gap: 0.25rem;
  align-items: center;
  /* 按钮必须 no-drag，否则点不动 */
  -webkit-app-region: no-drag;
}

.ctl {
  display: grid;
  place-items: center;
  width: 2.5rem;
  height: 2.5rem;
  padding: 0;
  color: var(--text-2);
  background: transparent;
  border: 0;
  border-radius: var(--radius-sm);
  cursor: default;
  transition:
    background-color var(--transition-fast),
    color var(--transition-fast);
}

.ctl:hover {
  color: var(--text-1);
  background: var(--surface-2);
}

.ctl--close:hover {
  color: #fff;
  background: var(--danger);
}
</style>
