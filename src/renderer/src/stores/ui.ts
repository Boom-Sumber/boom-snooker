/**
 * UI 状态（纯界面，不含业务数据）
 *
 * 放在 store 里而不是组件局部 ref 的原因：侧栏折叠同时被 SideBar / TopBar /
 * MainLayout 三处读写，组件间用 props/emit 传来传去迟早漏一个。
 */
import { defineStore } from 'pinia'
import { ref } from 'vue'

export const useUiStore = defineStore('ui', () => {
  /** 侧栏是否折叠（窗口变窄时手动收） */
  const sidebarCollapsed = ref(false)

  /** 全局遮罩：首次同步、批量操作时用 */
  const globalLoading = ref(false)

  function toggleSidebar(): void {
    sidebarCollapsed.value = !sidebarCollapsed.value
  }

  function setSidebarCollapsed(value: boolean): void {
    sidebarCollapsed.value = value
  }

  return { sidebarCollapsed, globalLoading, toggleSidebar, setSidebarCollapsed }
})
