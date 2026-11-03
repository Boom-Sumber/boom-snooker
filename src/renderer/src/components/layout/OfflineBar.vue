<script setup lang="ts">
/**
 * 全局离线提示条（T6.1）
 *
 * 位置：TopBar 与内容区之间，**不覆盖内容**（不用 toast/浮层）——
 * 离线可能持续很久，浮层会挡住操作且会消失，用户就不知道"为什么按钮是灰的"。
 *
 * 三种文案由 network store 的 `reason` 决定：
 *   · disconnected —— 网卡断了
 *   · unreachable  —— 有网但服务端连不上（代理挂了 / Supabase 抖动）
 * 恢复后由 store 的 `online` 事件自动同步，提示条自己消失，不用用户点。
 */
import { computed } from 'vue'
import { ElMessage } from 'element-plus'
import { useNetworkStore } from '@renderer/stores'

const network = useNetworkStore()

const title = computed(() => (network.reason === 'disconnected' ? '网络已断开' : '连不上服务器'))

const detail = computed(() =>
  network.reason === 'disconnected'
    ? '当前显示本地缓存，浏览不受影响；评论、投稿、审核等写操作已暂停'
    : '当前显示本地缓存，浏览不受影响；写操作已暂停，连接恢复后自动继续'
)

async function onRetry(): Promise<void> {
  const ok = await network.retry()
  if (ok) {
    ElMessage.success('网络已恢复')
  } else {
    ElMessage.warning('还是连不上，稍后会自动再试')
  }
}
</script>

<template>
  <Transition name="offline-bar">
    <div v-if="network.offline" class="offline-bar" role="status" aria-live="polite">
      <svg class="offline-bar__icon" width="16" height="16" viewBox="0 0 16 16" aria-hidden="true">
        <path
          d="M2 6.2a9 9 0 0 1 12 0M4.4 8.8a5.6 5.6 0 0 1 7.2 0M6.9 11.4a2 2 0 0 1 2.2 0"
          fill="none"
          stroke="currentColor"
          stroke-width="1.4"
          stroke-linecap="round"
        />
        <circle cx="8" cy="13.6" r="0.9" fill="currentColor" />
        <path
          d="M2.4 2.4l11.2 11.2"
          stroke="currentColor"
          stroke-width="1.4"
          stroke-linecap="round"
        />
      </svg>

      <p class="offline-bar__text">
        <span class="offline-bar__title">{{ title }}</span>
        <span class="offline-bar__detail">{{ detail }}</span>
      </p>

      <el-button
        class="offline-bar__retry"
        size="small"
        :loading="network.retrying"
        @click="onRetry"
      >
        重试
      </el-button>
    </div>
  </Transition>
</template>

<style scoped>
.offline-bar {
  display: flex;
  flex: 0 0 auto;
  gap: 0.625rem;
  align-items: center;
  padding: 0.5rem 0.75rem;
  color: var(--text-1);
  background: color-mix(in srgb, var(--warning) 14%, var(--surface));
  border: 1px solid color-mix(in srgb, var(--warning) 45%, var(--border));
  border-radius: var(--radius-md);
}

.offline-bar__icon {
  flex: 0 0 auto;
  color: var(--warning);
}

.offline-bar__text {
  display: flex;
  flex: 1;
  flex-wrap: wrap;
  gap: 0.25rem 0.5rem;
  align-items: baseline;
  min-width: 0;
  margin: 0;
  font-size: var(--font-size-sm);
  line-height: 1.4;
}

.offline-bar__title {
  font-weight: 600;
}

.offline-bar__detail {
  color: var(--text-2);
}

.offline-bar__retry {
  flex: 0 0 auto;
}

/* 出现/消失都从上方滑一点，避免内容区突然跳一格 */
.offline-bar-enter-active,
.offline-bar-leave-active {
  transition:
    opacity var(--transition-fast),
    transform var(--transition-fast);
}

.offline-bar-enter-from,
.offline-bar-leave-to {
  opacity: 0;
  transform: translateY(-0.25rem);
}
</style>
