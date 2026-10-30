<script setup lang="ts">
import { storeToRefs } from 'pinia'
import SideBar from '@renderer/components/layout/SideBar.vue'
import TopBar from '@renderer/components/layout/TopBar.vue'
import { useUiStore } from '@renderer/stores'

/** 侧栏折叠：状态放 ui store，SideBar / TopBar / 本组件三处都要读写 */
const ui = useUiStore()
const { sidebarCollapsed: collapsed } = storeToRefs(ui)
</script>

<template>
  <div class="main-layout">
    <SideBar :collapsed="collapsed" @expand="ui.setSidebarCollapsed(false)" />

    <div class="main-layout__main">
      <TopBar :collapsed="collapsed" @toggle-sidebar="ui.toggleSidebar()" />

      <main class="main-layout__content card">
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
  gap: 0.75rem;
  height: 100%;
  padding: 0.75rem;
  background: var(--bg);
}

.main-layout__main {
  display: flex;
  flex: 1;
  flex-direction: column;
  gap: 0.75rem;
  min-width: 0;
}

.main-layout__content {
  flex: 1;
  min-height: 0;
  overflow: auto;
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
