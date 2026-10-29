<script setup lang="ts">
import { onBeforeUnmount, onMounted, ref } from 'vue'

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
  <header class="title-bar">
    <!-- 整条都是拖拽区；双击由 Electron 原生处理（会自动最大化/还原），不要自己再绑 dblclick -->
    <div class="title-bar__drag">
      <span class="title-bar__title">斯诺克走位教学</span>
    </div>

    <div class="title-bar__controls">
      <button class="ctl" type="button" aria-label="最小化" title="最小化" @click="minimize">
        <svg width="10" height="10" viewBox="0 0 10 10" aria-hidden="true">
          <path d="M1 5h8" stroke="currentColor" stroke-width="1.2" />
        </svg>
      </button>

      <button
        class="ctl"
        type="button"
        :aria-label="isMaximized ? '还原' : '最大化'"
        :title="isMaximized ? '还原' : '最大化'"
        :data-maximized="isMaximized"
        @click="toggleMaximize"
      >
        <svg v-if="!isMaximized" width="10" height="10" viewBox="0 0 10 10" aria-hidden="true">
          <rect
            x="1.2"
            y="1.2"
            width="7.6"
            height="7.6"
            fill="none"
            stroke="currentColor"
            stroke-width="1.2"
          />
        </svg>
        <svg v-else width="10" height="10" viewBox="0 0 10 10" aria-hidden="true">
          <rect
            x="1.2"
            y="3"
            width="5.8"
            height="5.8"
            fill="none"
            stroke="currentColor"
            stroke-width="1.2"
          />
          <path d="M3 3V1.2h5.8V7H7" fill="none" stroke="currentColor" stroke-width="1.2" />
        </svg>
      </button>

      <button class="ctl ctl--close" type="button" aria-label="关闭" title="关闭" @click="close">
        <svg width="10" height="10" viewBox="0 0 10 10" aria-hidden="true">
          <path d="M1.5 1.5l7 7M8.5 1.5l-7 7" stroke="currentColor" stroke-width="1.2" />
        </svg>
      </button>
    </div>
  </header>
</template>

<style scoped>
.title-bar {
  --titlebar-height: 2.5rem;

  display: flex;
  flex: 0 0 auto;
  align-items: stretch;
  height: var(--titlebar-height);
  background: var(--surface);
  border-bottom: 1px solid var(--border);
  user-select: none;
  -webkit-app-region: drag;
}

.title-bar__drag {
  display: flex;
  flex: 1;
  align-items: center;
  min-width: 0;
  padding-inline: 0.875rem;
}

.title-bar__title {
  overflow: hidden;
  color: var(--text-2);
  font-size: var(--font-size-sm);
  white-space: nowrap;
  text-overflow: ellipsis;
}

.title-bar__controls {
  display: flex;
  flex: 0 0 auto;
  /* 按钮必须 no-drag，否则点不动 */
  -webkit-app-region: no-drag;
}

.ctl {
  display: grid;
  place-items: center;
  width: 2.875rem;
  padding: 0;
  color: var(--text-2);
  background: transparent;
  border: 0;
  cursor: default;
  transition:
    background-color var(--transition-fast),
    color var(--transition-fast);
}

.ctl:hover {
  color: var(--text-1);
  background: var(--surface-2);
}

.ctl:active {
  background: var(--border);
}

.ctl--close:hover {
  color: #fff;
  background: var(--danger);
}

.ctl--close:active {
  color: #fff;
  background: var(--danger);
  opacity: 0.85;
}

svg {
  display: block;
}
</style>
