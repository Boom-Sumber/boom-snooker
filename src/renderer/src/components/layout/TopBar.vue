<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref } from 'vue'
import { storeToRefs } from 'pinia'
import { ElMessage } from 'element-plus'
import AppIcon from '@renderer/components/AppIcon.vue'
import { iconSize, type IconName } from '@renderer/icons'
import avatarBoy from '@renderer/assets/avatars/avatar-boy.png'
import { useAuthStore, useDatasetStore, useThemeStore } from '@renderer/stores'
import WindowControls from './WindowControls.vue'

defineProps<{ collapsed: boolean }>()
const emit = defineEmits<{ (event: 'toggle-sidebar'): void }>()

/** 秒级时钟（旧版顶部栏就是这样） */
const now = ref(new Date())
let timer: number | undefined

onMounted(() => {
  timer = window.setInterval(() => {
    now.value = new Date()
  }, 1000)
})

onBeforeUnmount(() => {
  if (timer !== undefined) window.clearInterval(timer)
})

const pad = (value: number): string => String(value).padStart(2, '0')

const clock = computed(() => {
  const d = now.value
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`
})

/**
 * 主题切换：只做「亮 ↔ 暗」两态。
 * 「跟随系统」留到设置页再加（用户要求），这里不暴露第三档。
 */
const theme = useThemeStore()
const { isDark: themeIsDark } = storeToRefs(theme)

const themeIcon = computed<IconName>(() => (themeIsDark.value ? 'moon' : 'sun'))

function toggleTheme(): void {
  void theme.toggle()
}

/** 头像与昵称：登录后跟着 profile 走，未登录显示占位 */
const auth = useAuthStore()
const { nickname, avatar } = storeToRefs(auth)
const avatarSrc = computed(() => avatar.value || avatarBoy)

/** 待审数量：T4.3 接审核接口，0 时不显示红点 */
const pendingCount = ref(0)

/** 手动同步：强制重下全量快照（T2.4） */
const dataset = useDatasetStore()

async function onRefresh(): Promise<void> {
  const status = await dataset.sync(true)
  const text: Record<string, string> = {
    updated: '数据已更新',
    'up-to-date': '已是最新版本',
    offline: '连不上服务器，继续使用本地数据',
    error: dataset.lastError || '同步失败'
  }
  const message = text[status] ?? '同步完成'
  if (status === 'updated' || status === 'up-to-date') {
    ElMessage.success(message)
  } else {
    ElMessage.warning(message)
  }
}
</script>

<template>
  <header class="topbar card">
    <div class="topbar__left">
      <button
        class="icon-btn no-drag"
        type="button"
        :aria-label="collapsed ? '展开侧栏' : '收起侧栏'"
        :title="collapsed ? '展开侧栏' : '收起侧栏'"
        @click="emit('toggle-sidebar')"
      >
        <svg width="16" height="16" viewBox="0 0 16 16" aria-hidden="true">
          <path d="M2 4h12M2 8h12M2 12h12" stroke="currentColor" stroke-width="1.4" />
        </svg>
      </button>

      <el-avatar :size="40" :src="avatarSrc" class="no-drag" />

      <div class="who">
        <span class="who__name">{{ nickname || '未登录' }}</span>
        <span class="who__time">{{ clock }}</span>
      </div>
    </div>

    <div class="topbar__right no-drag">
      <el-button @click="onRefresh">数据更新</el-button>

      <!-- 铃铛与主题按钮共用 .icon-btn：同样的 2rem 方形盒，垂直对齐才一致 -->
      <span class="icon-btn" :title="pendingCount > 0 ? `待审 ${pendingCount} 条` : '暂无待审'">
        <el-badge :is-dot="pendingCount > 0" :offset="[-2, 2]">
          <AppIcon name="bell" size="1.125rem" />
        </el-badge>
      </span>

      <button
        class="icon-btn"
        type="button"
        :title="themeIsDark ? '切换到亮色' : '切换到暗色'"
        :aria-label="themeIsDark ? '切换到亮色' : '切换到暗色'"
        @click="toggleTheme"
      >
        <AppIcon :name="themeIcon" :size="iconSize(themeIcon, '1.125rem')" />
      </button>

      <span class="divider" aria-hidden="true" />

      <WindowControls />
    </div>
  </header>
</template>

<style scoped>
.topbar {
  display: flex;
  flex: 0 0 auto;
  gap: 1rem;
  align-items: center;
  justify-content: space-between;
  min-height: 4rem;
  padding: 0.5rem 0.75rem 0.5rem 1rem;
  /* 整条顶栏可拖动窗口 */
  -webkit-app-region: drag;
}

.no-drag {
  -webkit-app-region: no-drag;
}

.topbar__left {
  display: flex;
  gap: 0.75rem;
  align-items: center;
  min-width: 0;
}

.topbar__right {
  display: flex;
  flex: 0 0 auto;
  gap: 0.5rem;
  align-items: center;
}

.icon-btn {
  display: grid;
  place-items: center;
  width: 2rem;
  height: 2rem;
  padding: 0;
  color: var(--text-2);
  background: transparent;
  border: 0;
  border-radius: var(--radius-sm);
  cursor: pointer;
  transition:
    background-color var(--transition-fast),
    color var(--transition-fast);
}

.icon-btn:hover {
  color: var(--text-1);
  background: var(--surface-2);
}

.who {
  display: flex;
  flex-direction: column;
  gap: 0.125rem;
  min-width: 0;
}

.who__name {
  overflow: hidden;
  font-size: 1rem;
  font-weight: 500;
  color: var(--text-1);
  white-space: nowrap;
  text-overflow: ellipsis;
}

.who__time {
  font-size: var(--font-size-sm);
  font-variant-numeric: tabular-nums;
  color: var(--text-3);
  white-space: nowrap;
}

/* el-badge 是 inline-block，里面的图标会按基线对齐、比按钮中心高 1~2px；
   改成 flex 居中，铃铛才和旁边的主题图标严格同高 */
.icon-btn :deep(.el-badge) {
  display: flex;
  align-items: center;
  justify-content: center;
  line-height: 1;
}

.divider {
  width: 1px;
  height: 1.5rem;
  margin-inline: 0.25rem;
  background: var(--border);
}
</style>
