<script setup lang="ts">
/**
 * 数据门（T6.4）：**本地没有数据可用时**的唯一界面
 *
 * 以前各页面各写一段 `<el-skeleton>` + 「数据还没同步完成，稍等一下…」，
 * 断网首次启动就会永远转圈 —— 用户既不知道发生了什么，也不知道能做什么。
 *
 * 这里把四种处境收敛成一处：
 *   ① loading  正在同步（首次运行 / 重试中）→ 阶段文案 + 进度条
 *   ② offline  没缓存且连不上服务端        → 说明「首次要联网一次」+ 重试
 *   ③ error    服务端有响应但出错          → 错误原因 + 重试
 *   ④ empty    同步成功但库里没有内容      → 「资料库还是空的」+ 重新检查
 *
 * `variant="home"` 用于首页：同一个状态，但补一段「数据存在本地」的解释，
 * 让第一次打开的人明白为什么值得等这一下。
 */
import { computed, ref } from 'vue'
import { storeToRefs } from 'pinia'
import { Box, Connection, Loading, WarningFilled } from '@element-plus/icons-vue'
import { useDatasetStore, useNetworkStore } from '@renderer/stores'

const props = withDefaults(
  defineProps<{
    /** page：列表/详情页里的占位；home：首页的首次运行引导 */
    variant?: 'page' | 'home'
  }>(),
  { variant: 'page' }
)

const dataset = useDatasetStore()
const network = useNetworkStore()
const { syncing, progress, syncState, lastError } = storeToRefs(dataset)

type Mode = 'loading' | 'offline' | 'error' | 'empty'

/**
 * 状态判定顺序有讲究：
 * `syncing` 永远优先 —— 用户点了重试之后，界面要立刻变成「正在下载」，
 * 而不是继续停在「连不上」上等着（否则会以为按钮没生效）。
 */
const mode = computed<Mode>(() => {
  if (syncing.value) return 'loading'
  if (syncState.value === 'offline') return 'offline'
  if (syncState.value === 'error') return 'error'
  // updated / up-to-date：服务端正常，但快照里就是没东西
  if (syncState.value === 'updated' || syncState.value === 'up-to-date') return 'empty'
  // idle：启动瞬间还没开始同步
  return 'loading'
})

const percent = computed(() => progress.value?.percent ?? 0)

/** 空库时点它是"再看看有没有新的"，说"重试"会让人以为刚才是失败了 */
const actionLabel = computed(() => (mode.value === 'empty' ? '重新检查' : '重试'))

const view = computed(() => {
  const isHome = props.variant === 'home'

  switch (mode.value) {
    case 'offline':
      return {
        icon: Connection,
        tone: 'warn' as const,
        spinning: false,
        title: isHome ? '第一次使用需要联网一次' : '还没有本地数据',
        desc: isHome
          ? '资料库要先完整下载到本地，之后断网也能照常查。检查一下网络或代理，再点下面的重试。'
          : '这份数据还没下载到本地，连不上服务器就没法显示。联网后点重试。',
        detail:
          network.reason === 'disconnected'
            ? '设备当前未连接网络'
            : // 「连不上服务器」跟上面的说明重复，只有更具体的原因才值得单独显示
              lastError.value && lastError.value !== '连不上服务器'
              ? lastError.value
              : ''
      }
    case 'error':
      return {
        icon: WarningFilled,
        tone: 'danger' as const,
        spinning: false,
        title: '数据加载出错了',
        desc: '服务器有响应，但返回的数据不对。可以重试一次；一直这样的话把下面的信息告诉管理员。',
        detail: lastError.value
      }
    case 'empty':
      return {
        icon: Box,
        tone: 'muted' as const,
        spinning: false,
        title: '资料库里还没有内容',
        desc: isHome
          ? '已经连上服务器，但暂时没有可浏览的打法与进阶系列。管理员在后台添加后，这里会自动出现。'
          : '服务器上暂时没有可显示的内容，稍后再同步一次试试。',
        detail: ''
      }
    default:
      return {
        icon: Loading,
        tone: 'muted' as const,
        spinning: true,
        title: isHome ? '正在准备离线数据' : '正在下载数据',
        desc: isHome
          ? '只有第一次启动需要等这一下。数据会完整存到本地，之后打开就是秒开，断网也能查。'
          : '第一次打开需要把资料库下载到本地，之后就不用再等了。',
        detail: ''
      }
  }
})

/** 首页才展示的"为什么要等"三句话 */
const steps = ['联网下载一次完整资料库', '存到本地，之后断网也能查', '每次启动自动比对有没有新版']

const retrying = ref(false)

async function onRetry(): Promise<void> {
  if (retrying.value) return
  retrying.value = true
  try {
    await dataset.sync()
  } finally {
    retrying.value = false
  }
}
</script>

<template>
  <div class="gate" :class="[`gate--${variant}`, `gate--${view.tone}`]">
    <div class="gate__icon">
      <el-icon :size="'1.5rem'" :class="{ 'is-loading': view.spinning }">
        <component :is="view.icon" />
      </el-icon>
    </div>

    <h2 class="gate__title">{{ view.title }}</h2>
    <p class="gate__desc">{{ view.desc }}</p>

    <!-- 进度：只在同步中显示。阶段文案来自 shared/sync，界面这里不自己编 -->
    <div v-if="mode === 'loading'" class="gate__progress">
      <el-progress :percentage="percent" :stroke-width="6" :show-text="false" />
      <div class="gate__progress-meta">
        <span>{{ progress?.message ?? '正在连接服务器…' }}</span>
        <span class="gate__percent">{{ percent }}%</span>
      </div>
    </div>

    <ul v-if="variant === 'home' && mode === 'loading'" class="gate__steps">
      <li v-for="(step, index) in steps" :key="step" class="gate__step">
        <span class="gate__step-index">{{ index + 1 }}</span>
        <span>{{ step }}</span>
      </li>
    </ul>

    <p v-if="view.detail" class="gate__detail">{{ view.detail }}</p>

    <div v-if="mode !== 'loading'" class="gate__actions">
      <!--
        断网时也**不禁用**重试：`navigator.onLine` 在 Windows 上经常是过期的，
        禁用会把用户锁死在一个永远点不动的按钮上。点一下失败很快，不如让他试。
      -->
      <el-button type="primary" :loading="retrying || syncing" @click="onRetry">
        {{ actionLabel }}
      </el-button>
      <span v-if="network.reason === 'disconnected'" class="gate__tip">
        当前设备显示为离线，联网后会自动重试
      </span>
    </div>
  </div>
</template>

<style scoped>
.gate {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 0.5rem;
  min-height: 16rem;
  padding: clamp(1.5rem, 4vw, 3rem) clamp(1rem, 3vw, 2rem);
  text-align: center;
}

/* 首页那块要撑起来，否则首次运行会是一小条挤在顶上的卡片 */
.gate--home {
  min-height: 22rem;
}

.gate__icon {
  display: grid;
  place-items: center;
  width: 3rem;
  height: 3rem;
  color: var(--primary);
  background: color-mix(in srgb, var(--primary) 12%, transparent);
  border-radius: 50%;
}

.gate--warn .gate__icon {
  color: var(--warning);
  background: color-mix(in srgb, var(--warning) 14%, transparent);
}

.gate--danger .gate__icon {
  color: var(--danger);
  background: color-mix(in srgb, var(--danger) 14%, transparent);
}

.gate__title {
  margin: 0.5rem 0 0;
  font-size: var(--font-size-lg);
  font-weight: 500;
  color: var(--text-1);
}

.gate__desc {
  max-width: 34rem;
  margin: 0;
  font-size: var(--font-size-sm);
  line-height: 1.9;
  color: var(--text-2);
}

.gate__progress {
  width: min(24rem, 100%);
  margin-top: 1rem;
}

.gate__progress-meta {
  display: flex;
  justify-content: space-between;
  gap: 1rem;
  margin-top: 0.5rem;
  font-size: var(--font-size-sm);
  color: var(--text-3);
}

.gate__percent {
  font-variant-numeric: tabular-nums;
}

.gate__steps {
  display: flex;
  flex-direction: column;
  gap: 0.5rem;
  margin: 1.25rem 0 0;
  padding: 0;
  list-style: none;
  text-align: left;
}

.gate__step {
  display: flex;
  gap: 0.625rem;
  align-items: center;
  font-size: var(--font-size-sm);
  line-height: 1.7;
  color: var(--text-2);
}

.gate__step-index {
  display: grid;
  flex: 0 0 auto;
  place-items: center;
  width: 1.25rem;
  height: 1.25rem;
  font-size: 0.75rem;
  font-variant-numeric: tabular-nums;
  color: var(--primary);
  background: color-mix(in srgb, var(--primary) 12%, transparent);
  border-radius: 50%;
}

.gate__detail {
  max-width: 34rem;
  margin: 0.25rem 0 0;
  font-size: var(--font-size-sm);
  line-height: 1.8;
  color: var(--text-3);
  word-break: break-word;
}

.gate__actions {
  display: flex;
  flex-wrap: wrap;
  gap: 0.75rem;
  align-items: center;
  justify-content: center;
  margin-top: 1rem;
}

.gate__tip {
  font-size: var(--font-size-sm);
  color: var(--text-3);
}
</style>
