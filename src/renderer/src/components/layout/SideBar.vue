<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import { useRoute } from 'vue-router'
import { findGroupKeyByPath, navGroups, type NavGroup } from '@renderer/navigation/menu'

const props = defineProps<{ collapsed: boolean }>()
const emit = defineEmits<{ (event: 'expand'): void }>()

const route = useRoute()

// 默认展开「主页」「彩球」，跟旧版一致
const openGroups = ref<string[]>(['home', 'balls'])

const activeGroupKey = computed(() => findGroupKeyByPath(route.path))

// 路由变化时自动展开所属分组（比如从顶部栏跳进来）
watch(
  () => route.path,
  (path) => {
    const key = findGroupKeyByPath(path)
    if (key && !openGroups.value.includes(key)) {
      openGroups.value = [...openGroups.value, key]
    }
  },
  { immediate: true }
)

function isOpen(key: string): boolean {
  return openGroups.value.includes(key)
}

function toggleGroup(key: string): void {
  openGroups.value = isOpen(key)
    ? openGroups.value.filter((item) => item !== key)
    : [...openGroups.value, key]
}

function onGroupClick(group: NavGroup): void {
  // 折叠态下点分组：先把侧栏展开，再打开这个分组
  if (props.collapsed) {
    emit('expand')
    if (!isOpen(group.key)) openGroups.value = [...openGroups.value, group.key]
    return
  }
  toggleGroup(group.key)
}

function isActive(path: string): boolean {
  return route.path === path
}
</script>

<template>
  <aside class="sidebar card" :class="{ 'sidebar--collapsed': collapsed }">
    <div class="sidebar__logo">
      <span class="sidebar__mark" aria-hidden="true">
        <svg viewBox="0 0 24 24" fill="none">
          <circle cx="12" cy="12" r="10" stroke="currentColor" stroke-width="1.6" />
          <circle cx="9.5" cy="13.5" r="2.6" fill="currentColor" />
          <path d="M6.5 17.5L16.5 7.5" stroke="currentColor" stroke-width="1.6" />
        </svg>
      </span>
      <span v-if="!collapsed" class="sidebar__name">Snooker</span>
    </div>

    <nav class="sidebar__nav">
      <div v-for="group in navGroups" :key="group.key" class="group">
        <!-- 折叠态：只显示一个字，点了展开侧栏 -->
        <button
          v-if="collapsed"
          class="group__badge"
          :class="{ 'is-active': activeGroupKey === group.key }"
          type="button"
          :title="group.label"
          @click="onGroupClick(group)"
        >
          {{ group.short }}
        </button>

        <template v-else>
          <!--
            一级菜单：占位图标 + 文本。
            当前分组只用左侧竖线表示，图标与文本不改色（用户要求）
          -->
          <button
            class="group__header"
            :class="{ 'is-active': activeGroupKey === group.key }"
            type="button"
            @click="onGroupClick(group)"
          >
            <span class="group__icon" aria-hidden="true">
              <svg viewBox="0 0 16 16" fill="none">
                <rect
                  x="2.6"
                  y="2.6"
                  width="10.8"
                  height="10.8"
                  rx="2.6"
                  stroke="currentColor"
                  stroke-width="1.3"
                />
              </svg>
            </span>
            <span class="group__label">{{ group.label }}</span>
          </button>

          <ul v-show="isOpen(group.key)" class="group__items">
            <li v-for="item in group.items" :key="item.path">
              <RouterLink
                :to="item.path"
                class="item"
                :class="{ 'is-active': isActive(item.path) }"
              >
                {{ item.label }}
              </RouterLink>
            </li>
          </ul>
        </template>
      </div>
    </nav>
  </aside>
</template>

<style scoped>
.sidebar {
  display: flex;
  flex: 0 0 auto;
  flex-direction: column;
  gap: 1.5rem;
  width: var(--sidebar-width);
  padding: 1.25rem 0.875rem 1.5rem;
  overflow-x: hidden;
  overflow-y: auto;
  color: var(--sidebar-text);
  background: var(--sidebar-bg);
  transition: width var(--transition-fast);
}

.sidebar--collapsed {
  align-items: center;
  width: var(--sidebar-width-collapsed);
  padding-inline: 0.5rem;
}

/* 滚动条在侧栏里要细、要淡 */
.sidebar::-webkit-scrollbar {
  width: 6px;
}

.sidebar::-webkit-scrollbar-thumb {
  background: var(--border);
}

.sidebar__logo {
  display: flex;
  gap: 0.625rem;
  align-items: center;
  padding-inline: 0.375rem;
}

.sidebar--collapsed .sidebar__logo {
  padding-inline: 0;
}

.sidebar__mark {
  display: grid;
  flex: 0 0 auto;
  place-items: center;
  width: 2.5rem;
  height: 2.5rem;
  padding: 0.35rem;
  color: #fff;
  background: var(--primary);
  border-radius: 50%;
}

.sidebar__mark svg {
  width: 100%;
  height: 100%;
}

.sidebar__name {
  color: var(--text-1);
  font-size: clamp(1.125rem, 1.3vw, 1.375rem);
  font-weight: 600;
  letter-spacing: 0.02em;
  white-space: nowrap;
}

.sidebar__nav {
  display: flex;
  flex-direction: column;
  gap: 0.375rem;
}

.group {
  display: flex;
  flex-direction: column;
  gap: 0.125rem;
}

/* ---------- 一级菜单 ---------- */

.group__header {
  position: relative;
  display: flex;
  gap: 0.875rem;
  align-items: center;
  padding: 0.5rem 0.625rem;
  font-family: inherit;
  font-size: 1.0625rem;
  font-weight: 600;
  color: var(--sidebar-text);
  text-align: left;
  background: transparent;
  border: 0;
  border-radius: var(--radius-sm);
  cursor: pointer;
  transition: background-color var(--transition-fast);
}

.group__header:hover {
  background: var(--sidebar-hover);
}

/* 当前分组：左侧一条主题色竖线，图标与文本颜色不变 */
.group__header.is-active::before,
.group__badge.is-active::before {
  position: absolute;
  top: 50%;
  left: -0.5rem;
  width: 3px;
  height: 1.125rem;
  background: var(--sidebar-indicator);
  border-radius: 2px;
  transform: translateY(-50%);
  content: '';
}

.group__icon {
  display: grid;
  flex: 0 0 auto;
  place-items: center;
  width: 1.25rem;
  height: 1.25rem;
  color: var(--text-3);
}

.group__icon svg {
  width: 100%;
  height: 100%;
}

.group__label {
  overflow: hidden;
  white-space: nowrap;
  text-overflow: ellipsis;
}

.group__badge {
  position: relative;
  display: grid;
  place-items: center;
  width: 2.25rem;
  height: 2.25rem;
  font-family: inherit;
  font-size: 1.0625rem;
  color: var(--sidebar-text);
  background: transparent;
  border: 0;
  border-radius: var(--radius-sm);
  cursor: pointer;
}

.group__badge:hover {
  background: var(--sidebar-hover);
}

/* ---------- 二级菜单 ---------- */

.group__items {
  display: flex;
  flex-direction: column;
  gap: 0.125rem;
  margin: 0;
  padding: 0;
  list-style: none;
}

.item {
  display: block;
  padding: 0.5rem 0.75rem 0.5rem 2.75rem;
  font-size: 1rem;
  font-weight: 500;
  color: var(--text-2);
  text-decoration: none;
  border-radius: var(--radius-sm);
  transition:
    background-color var(--transition-fast),
    color var(--transition-fast);
}

.item:hover {
  color: var(--text-1);
  background: var(--sidebar-hover);
}

.item.is-active {
  color: var(--sidebar-active-text);
  background: var(--sidebar-active-bg);
}
</style>
