<script setup lang="ts">
/**
 * 强制更新弹窗（U3）
 *
 * 只有 `mandatory` 时才出现 —— 非强制更新一律不弹窗，只在侧栏亮红点 + 托盘 tooltip 提示，
 * 免得每次后台检查都跳出来打断用户。
 *
 * 既然是"强制"，就不能有「稍后」：关闭按钮、点遮罩、ESC 全部关掉，
 * 出口只有两个 —— 更新完重启，或者退出程序。
 * 这一步刻意做成"点一下就能退出"而不是把窗口钉死：网络差的时候 130 MB 下不下来，
 * 用户至少还有一条路走，不用去任务管理器杀进程。
 *
 * dev 下 `phase` 恒为 `unsupported`，`mandatory` 也永远是 false，所以这个弹窗在开发时看不到。
 */
import { computed } from 'vue'
import { ElMessage } from 'element-plus'
import { useUpdateStore } from '@renderer/stores'

const update = useUpdateStore()

const visible = computed(() => update.showForcedDialog)
const phase = computed(() => update.phase)
const info = computed(() => update.info)
const percent = computed(() => update.percent)
const progress = computed(() => update.progress)

/** 下载速度：主进程给的是字节/秒，超过 1 MB/s 就换单位，免得显示一串数字 */
const speedText = computed(() => {
  const bps = progress.value?.bytesPerSecond ?? 0
  if (bps <= 0) return ''
  if (bps < 1024 * 1024) return `${(bps / 1024).toFixed(0)} KB/s`
  return `${(bps / 1024 / 1024).toFixed(1)} MB/s`
})

const sizeText = computed(() => {
  const bytes = info.value?.size ?? 0
  if (!bytes) return ''
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`
})

const title = computed(() => {
  if (phase.value === 'downloaded') return '更新已就绪'
  return `发现新版本 v${info.value?.version ?? ''}`
})

async function onDownload(): Promise<void> {
  try {
    await update.download()
  } catch {
    ElMessage.error('下载没能开始，稍后再试')
  }
}

async function onCancel(): Promise<void> {
  await update.cancel()
}

async function onInstall(): Promise<void> {
  // 调用后进程很快就会被关掉，这里不要 await 任何后续操作
  await update.install()
}

async function onQuit(): Promise<void> {
  await window.api.system.quit()
}

/**
 * 右上角关闭 = 退出程序（2026-11-04）
 *
 * 「关闭弹窗则直接退出应用」：强制更新没有"稍后再说"这条路。
 * 走 `before-close` 而不是 `@close` —— 后者是关闭动画结束后才触发，
 * 期间弹窗会先消失一下再退出，观感像"关掉了但程序还在"。
 */
function onCloseForced(): void {
  void window.api.system.quit()
}
</script>

<template>
  <el-dialog
    :model-value="visible"
    :title="title"
    width="440px"
    align-center
    append-to-body
    :show-close="true"
    :before-close="onCloseForced"
    :close-on-click-modal="false"
    :close-on-press-escape="false"
  >
    <div class="update">
      <p class="update__lead">
        当前版本 v{{ update.state.currentVersion || '—' }}，需要更新到 v{{ info?.version }}
        才能继续使用。
      </p>
      <p v-if="update.state.minSupportedVersion" class="update__hint">
        本版本已低于最低支持版本 v{{
          update.state.minSupportedVersion
        }}，旧版的接口与数据格式可能已经变了。
      </p>
      <p v-else class="update__hint">这次更新由作者标记为必须更新。</p>
      <p class="update__hint">这个提示不能跳过；关闭它会直接退出程序。</p>

      <!-- 下载中：进度条 + 已下载/总量 + 速度，全部来自主进程快照 -->
      <template v-if="phase === 'downloading'">
        <el-progress class="update__progress" :percentage="percent" :stroke-width="8" />
        <p class="update__meta">
          已下载 {{ percent }}%
          <template v-if="progress && progress.total">
            · {{ (progress.transferred / 1024 / 1024).toFixed(1) }} /
            {{ (progress.total / 1024 / 1024).toFixed(1) }} MB
          </template>
          <template v-if="speedText">· {{ speedText }}</template>
        </p>
      </template>

      <p v-else-if="phase === 'downloaded'" class="update__ready">
        安装包已下载完成（{{ sizeText }}），重启后会自动安装，不需要再点下一步。
      </p>

      <el-alert v-else-if="phase === 'error'" :closable="false" type="error" show-icon>
        <template #title>下载失败</template>
        {{ update.state.error || '网络可能不太稳定，重试一次通常就好了。' }}
      </el-alert>

      <p v-else-if="sizeText" class="update__meta">安装包 {{ sizeText }}，下载速度取决于网络。</p>
    </div>

    <template #footer>
      <el-button @click="onQuit">退出程序</el-button>

      <el-button v-if="phase === 'downloading'" @click="onCancel">取消下载</el-button>
      <el-button v-else-if="phase === 'downloaded'" type="primary" @click="onInstall">
        立即重启安装
      </el-button>
      <el-button
        v-else-if="phase === 'error'"
        type="primary"
        :loading="update.busy"
        @click="onDownload"
      >
        重试
      </el-button>
      <el-button v-else type="primary" :loading="update.busy" @click="onDownload"
        >立即更新</el-button
      >
    </template>
  </el-dialog>
</template>

<style scoped>
.update {
  font-size: var(--font-size-sm);
  line-height: 1.8;
  color: var(--text-1);
}

.update__lead {
  margin: 0;
}

.update__hint {
  margin: 0.375rem 0 0;
  color: var(--text-3);
}

.update__progress {
  margin-top: 1rem;
}

.update__meta {
  margin: 0.5rem 0 0;
  color: var(--text-2);
  font-variant-numeric: tabular-nums;
}

.update__ready {
  margin: 0.75rem 0 0;
  color: var(--success);
}
</style>
