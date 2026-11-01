<script setup lang="ts">
import { computed, onMounted, ref, watch } from 'vue'
import { useRoute } from 'vue-router'
import {
  findGroupKeyByPath,
  matchesPath,
  visibleNavGroups,
  type NavGroup
} from '@renderer/navigation/menu'
import AppIcon from '@renderer/components/AppIcon.vue'
import { iconSize } from '@renderer/icons'
import { useAuthStore } from '@renderer/stores'

const props = defineProps<{ collapsed: boolean }>()
const emit = defineEmits<{ (event: 'expand'): void }>()

const route = useRoute()
const auth = useAuthStore()

/**
 * 按当前角色过滤后的菜单
 *
 * 「账户管理」只对 admin / superadmin 显示；未登录与普通用户看不到这一项。
 * 这里只是"看不见"，进不进得去由 router 的 meta.roles 守卫决定。
 */
const groups = computed(() => visibleNavGroups(auth.role))

// 默认展开「主页」「彩球」，跟旧版一致
const openGroups = ref<string[]>(['home', 'balls'])

const activeGroupKey = computed(() => findGroupKeyByPath(route.path))

/**
 * 二级菜单对齐：同一分组内按最长的那条算统一宽度，
 * 每条文字在这个宽度里居中 —— 短字符两侧自动留白，左右边界就齐了。
 * 用 canvas 量，不依赖 DOM 可见性（分组收起时也能算），也不用手工插空格。
 */
const labelWidths = ref<Record<string, number>>({})

async function measureLabelWidths(): Promise<void> {
  const ctx = document.createElement('canvas').getContext('2d')
  if (!ctx) return

  const rootStyle = getComputedStyle(document.documentElement)
  const family = rootStyle.getPropertyValue('--font-family-base').trim() || 'sans-serif'
  const rootSize = Number.parseFloat(rootStyle.fontSize) || 16

  // 等内置字体真正加载完，否则量到的是回退字体的宽度
  try {
    await document.fonts.load(`400 ${rootSize}px "PingFang SC"`)
  } catch {
    // 加载失败就用回退字体量，不影响功能
  }
  await document.fonts.ready

  // 与 .item 的字号/字重保持一致
  ctx.font = `400 ${rootSize}px ${family}`

  const next: Record<string, number> = {}
  for (const group of groups.value) {
    let max = 0
    for (const item of group.items) {
      max = Math.max(max, ctx.measureText(item.label).width)
    }
    // +1 吸收亚像素误差，避免最后一个字被挤到下一行
    next[group.key] = Math.ceil(max) + 1
  }
  labelWidths.value = next
}

function labelWidth(key: string): string | undefined {
  const width = labelWidths.value[key]
  return width ? `${width}px` : undefined
}

onMounted(() => {
  void measureLabelWidths()
})

// 登录 / 登出会改变可见项（多出或少掉「账户管理」），宽度要重量一次
watch(
  () => auth.role,
  () => {
    void measureLabelWidths()
  }
)

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

/** 详情页（`/advanced/break/<id>`）也要让所属系列保持高亮 */
function isActive(path: string): boolean {
  return matchesPath(route.path, path)
}
</script>

<template>
  <aside class="sidebar card" :class="{ 'sidebar--collapsed': collapsed }">
    <div class="sidebar__logo">
      <span class="sidebar__mark">
        <AppIcon name="logo" size="1.5rem" />
      </span>
      <span v-if="!collapsed" class="sidebar__name">Snooker</span>
    </div>

    <nav class="sidebar__nav">
      <div v-for="group in groups" :key="group.key" class="group">
        <!-- 折叠态：只显示分组图标（不是文字首字），点了展开侧栏 -->
        <button
          v-if="collapsed"
          class="group__badge"
          :class="{ 'is-active': activeGroupKey === group.key }"
          type="button"
          :title="group.label"
          :aria-label="group.label"
          @click="onGroupClick(group)"
        >
          <AppIcon :name="group.icon" :size="iconSize(group.icon)" />
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
            <span class="group__icon">
              <AppIcon :name="group.icon" :size="iconSize(group.icon)" />
            </span>
            <span class="group__label">{{ group.label }}</span>
          </button>

          <!--
            用 grid-template-rows 0fr → 1fr 做高度动画（不用 v-show，否则没有过渡）；
            缓动带一点过冲，收放时有弹簧感
          -->
          <div class="group__panel" :class="{ 'is-open': isOpen(group.key) }">
            <ul class="group__items">
              <li v-for="item in group.items" :key="item.path">
                <RouterLink
                  :to="item.path"
                  class="item"
                  :class="{ 'is-active': isActive(item.path) }"
                >
                  <span class="item__label" :style="{ width: labelWidth(group.key) }">
                    {{ item.label }}
                  </span>
                </RouterLink>
              </li>
            </ul>
          </div>
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
  width: var(--sidebar-width);
  padding: 0;
  /* 卡片本身不滚动：只有下面的菜单区滚，LOGO 区固定 */
  overflow: hidden;
  color: var(--sidebar-text);
  background: var(--sidebar-bg);
  transition: width var(--transition-fast);
}

.sidebar--collapsed {
  width: var(--sidebar-width-collapsed);
}

.sidebar__logo {
  display: flex;
  flex: 0 0 auto;
  gap: 0.75rem;
  align-items: center;
  justify-content: center;
  padding: 2rem 0.875rem 1.5rem;
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

.sidebar__name {
  color: var(--text-1);
  font-size: clamp(1.125rem, 1.3vw, 1.375rem);
  /* 只有 Regular 一个字重，这里是要「看起来更粗」，接受合成加粗 */
  font-weight: 600;
  letter-spacing: 0.02em;
  white-space: nowrap;
}

/* 菜单区：唯一的滚动容器，底部留出与卡片下边的间距 */
.sidebar__nav {
  display: flex;
  flex: 1;
  flex-direction: column;
  gap: 0.375rem;
  min-height: 0;
  padding: 0 1rem 1.25rem;
  overflow-x: hidden;
  overflow-y: auto;
}

.sidebar--collapsed .sidebar__nav {
  align-items: center;
  padding-inline: 0.5rem;
}

/* 滚动条：只覆盖菜单区，尽量收窄 */
.sidebar__nav::-webkit-scrollbar {
  width: 4px;
}

.sidebar__nav::-webkit-scrollbar-thumb {
  /* 4px 已经很细，颜色用 text-3 才看得出来 */
  background: var(--text-3);
  border-radius: 2px;
}

.sidebar__nav::-webkit-scrollbar-track {
  background: transparent;
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
  font-weight: 400;
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

/* 展开态：当前分组左侧一条主题色竖线，图标与文本颜色不变 */
.group__header.is-active::before {
  position: absolute;
  top: 50%;
  /* 别贴着卡片左边，留出一点呼吸感 */
  left: 0;
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
  /* 与文本同色（原来用 --text-3 太浅） */
  color: inherit;
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
  color: var(--sidebar-text);
  background: transparent;
  border: 0;
  border-radius: var(--radius-sm);
  cursor: pointer;
}

.group__badge:hover {
  background: var(--sidebar-hover);
}

/* 折叠态没有竖线的空间，直接用主题色图标表示当前分组 */
.group__badge.is-active {
  color: var(--sidebar-active-text);
}

/* ---------- 二级菜单 ---------- */

/* 高度动画容器：0fr → 1fr 可以过渡，v-show 不行 */
.group__panel {
  display: grid;
  grid-template-rows: 0fr;
  transition: grid-template-rows 320ms cubic-bezier(0.34, 1.56, 0.64, 1);
}

.group__panel.is-open {
  grid-template-rows: 1fr;
}

.group__items {
  display: flex;
  flex-direction: column;
  gap: 0.125rem;
  min-height: 0;
  margin: 0;
  padding: 0;
  overflow: hidden;
  list-style: none;
}

.item {
  display: block;
  padding: 0.5rem 0.75rem;
  font-size: 1rem;
  font-weight: 400;
  color: var(--text-1);
  text-align: center;
  text-decoration: none;
  border-radius: var(--radius-sm);
  /*
   * 条目自身的「弹簧」：收起时上移 + 淡出，展开时落回原位。
   * 缓动过冲 20%，所以会轻微弹一下再稳住 —— 高度动画（grid 0fr→1fr）在 1fr 处会被
   * 截断、吃不到过冲，所以回弹放在条目上才看得见
   */
  opacity: 0;
  transform: translateY(-0.875rem);
  transition:
    transform 340ms cubic-bezier(0.34, 1.8, 0.5, 1),
    opacity 200ms ease,
    background-color var(--transition-fast),
    color var(--transition-fast);
}

.group__panel.is-open .item {
  opacity: 1;
  transform: translateY(0);
}

/*
 * 同一分组内统一宽度 + 两端对齐：
 * 两个字（黄球）会把多出来的宽度摊到字与字之间，撑满到三个字（咖啡球）的宽度，
 * 这样左右边界都对齐，视觉上也居中 —— 不用往数据里插空格
 */
.item__label {
  display: inline-block;
  text-align: justify;
  text-align-last: justify;
  white-space: nowrap;
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
