<script setup lang="ts">
import { ref } from 'vue'
import SideBar from '@renderer/components/layout/SideBar.vue'
import TopBar from '@renderer/components/layout/TopBar.vue'

/** 侧栏折叠状态：旧版没有，是为了窗口缩小时不挤内容区（T2.5 再考虑放 Pinia） */
const collapsed = ref(false)
</script>

<template>
  <div class="main-layout">
    <SideBar :collapsed="collapsed" @expand="collapsed = false" />

    <div class="main-layout__main">
      <TopBar :collapsed="collapsed" @toggle-sidebar="collapsed = !collapsed" />

      <main class="main-layout__content">
        <RouterView v-slot="{ Component }">
          <Transition name="page" mode="out-in">
            <component :is="Component" />
          </Transition>
        </RouterView>
      </main>
    </div>
  </div>
</template>

<style scoped>
.main-layout {
  display: flex;
  height: 100%;
  background: var(--bg);
}

.main-layout__main {
  display: flex;
  flex: 1;
  flex-direction: column;
  gap: 0.75rem;
  min-width: 0;
  padding: 0.75rem;
}

.main-layout__content {
  flex: 1;
  min-height: 0;
  overflow: auto;
  background: var(--surface);
  border: 1px solid var(--border);
  border-radius: var(--radius-lg);
}

.page-enter-active,
.page-leave-active {
  transition: opacity var(--transition-fast);
}

.page-enter-from,
.page-leave-to {
  opacity: 0;
}
</style>
