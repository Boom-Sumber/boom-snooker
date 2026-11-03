<script setup lang="ts">
/**
 * 系统设置（T3.7）
 *
 * 三块：主题 / 数据同步 / 版本与关于。
 *
 * 「关于」不再单独开页（旧版有，新版并入这里）—— 版本号、运行时版本、
 * 作者联系方式都属于"看一眼就行"的信息，单独一页反而多一次点击。
 *
 * 版本号从主进程 `app:info` 拿，不写死：写死的话每次发版都要改代码。
 */
import { onMounted, ref } from 'vue'
import { ElMessage } from 'element-plus'
import { storeToRefs } from 'pinia'
import { useDatasetStore, useThemeStore } from '@renderer/stores'
import type { AppInfo } from '@shared/types/app'
import type { AutoStartState, CloseAction } from '@shared/types/system'
import type { ThemeMode } from '@shared/types/theme'

const theme = useThemeStore()
const dataset = useDatasetStore()
const { balls, advanced, version, lastSyncAt, syncing, progress, syncState } = storeToRefs(dataset)

const appInfo = ref<AppInfo | null>(null)
const syncingNow = ref(false)
/** 日志文件路径（T6.2）：排查问题时让用户直接打开/复制，不用教他去找 %APPDATA% */
const logPath = ref('')

/** 本机偏好（T10.1）：关闭窗口是缩到托盘还是直接退出 */
const closeAction = ref<CloseAction>('tray')
const prefsReady = ref(false)

/** 开机自启（T10.2）：状态以系统返回为准；dev 下不支持，开关置灰 */
const autoStart = ref(false)
const autoStartSupported = ref(false)

const CLOSE_OPTIONS: { value: CloseAction; label: string }[] = [
  { value: 'tray', label: '最小化到托盘' },
  { value: 'quit', label: '直接退出' }
]

const THEME_OPTIONS: { value: ThemeMode; label: string; hint: string }[] = [
  { value: 'light', label: '亮色', hint: '白天用' },
  { value: 'dark', label: '暗色', hint: '夜里不刺眼' },
  { value: 'system', label: '跟随系统', hint: '系统切了这里也跟着切' }
]

function formatTime(raw: number | null): string {
  if (!raw) return '—'
  const date = new Date(raw)
  if (Number.isNaN(date.getTime())) return '—'
  const pad = (n: number): string => String(n).padStart(2, '0')
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())} ${pad(date.getHours())}:${pad(date.getMinutes())}`
}

/** 同步状态 → 一句人话 */
function syncStateText(): string {
  if (syncingNow.value) return progress.value?.message ?? '同步中…'
  switch (syncState.value) {
    case 'updated':
      return '已更新到最新'
    case 'up-to-date':
      return '已是最新'
    case 'offline':
      return '连不上服务器，当前显示的是本地缓存'
    case 'error':
      return '同步出错，稍后再试'
    default:
      return '还没同步过'
  }
}

async function onSync(): Promise<void> {
  if (syncingNow.value) return
  syncingNow.value = true
  try {
    const state = await dataset.sync(true)
    if (state === 'updated') ElMessage.success('已更新到最新数据')
    else if (state === 'up-to-date') ElMessage.info('已经是最新版本')
    else if (state === 'offline') ElMessage.warning('连不上服务器，仍显示本地缓存')
    else ElMessage.error('同步失败，稍后再试')
  } finally {
    syncingNow.value = false
  }
}

async function onThemeChange(mode: ThemeMode): Promise<void> {
  await theme.setMode(mode)
}

/**
 * 改关闭行为（T10.1）
 *
 * 先改内存让用户立刻看到反馈，再落盘；主进程写失败也不会让界面跳回去 ——
 * 偏好文件写不进去只是"下次启动不记得"，本次会话仍然按用户的选择走。
 */
/**
 * 改开机自启（T10.2）
 *
 * 以主进程返回的**实际值**为准：系统可能拒绝写入（权限/策略），
 * 那时候开关要弹回去，不能显示一个假的成功。
 */
async function onAutoStartChange(value: boolean): Promise<void> {
  try {
    const state: AutoStartState = await window.api.system.autostart.set(value)
    autoStart.value = state.enabled
    autoStartSupported.value = state.supported
    if (state.enabled !== value) {
      ElMessage.warning('系统没有接受这个设置，可能没有权限')
    }
  } catch {
    ElMessage.error('设置开机自启动失败')
  }
}

async function onCloseActionChange(value: CloseAction): Promise<void> {
  closeAction.value = value
  try {
    await window.api.system.setPrefs({ closeAction: value })
  } catch {
    ElMessage.warning('设置没保存成功，这次生效、下次启动可能回到默认')
  }
}

onMounted(async () => {
  try {
    appInfo.value = await window.api.app.info()
  } catch {
    appInfo.value = null
  }

  try {
    logPath.value = await window.api.log.path()
  } catch {
    logPath.value = ''
  }

  try {
    const prefs = await window.api.system.prefs()
    closeAction.value = prefs.closeAction
    prefsReady.value = true
  } catch {
    // 拿不到偏好（老版本主进程 / IPC 没起来）：保持默认，不显示这块，免得误导
    prefsReady.value = false
  }

  try {
    const state = await window.api.system.autostart.get()
    autoStart.value = state.enabled
    autoStartSupported.value = state.supported
  } catch {
    autoStartSupported.value = false
  }
})

/** 在资源管理器里定位日志文件（不存在时打开所在目录） */
async function onOpenLog(): Promise<void> {
  try {
    await window.api.log.open()
  } catch {
    ElMessage.error('打不开日志目录')
  }
}

async function onCopyLogPath(): Promise<void> {
  if (!logPath.value) return
  try {
    await navigator.clipboard.writeText(logPath.value)
    ElMessage.success('路径已复制')
  } catch {
    ElMessage.error('复制失败，手动选中吧')
  }
}
</script>

<template>
  <section class="settings">
    <h1 class="settings__title">系统设置</h1>

    <!-- 主题 -->
    <article class="card block">
      <h2 class="block__title">主题</h2>
      <p class="block__hint">切换立即生效，不需要重启。</p>

      <el-radio-group :model-value="theme.mode" @change="onThemeChange">
        <el-radio-button v-for="option in THEME_OPTIONS" :key="option.value" :value="option.value">
          {{ option.label }}
        </el-radio-button>
      </el-radio-group>
      <p class="block__hint">
        {{ THEME_OPTIONS.find((item) => item.value === theme.mode)?.hint }}
      </p>
    </article>

    <!-- 数据同步 -->
    <article class="card block">
      <h2 class="block__title">数据同步</h2>
      <p class="block__hint">数据存在本地，断网也能查；这里只是主动拉一次最新的。</p>

      <dl class="facts">
        <div class="fact">
          <dt>快照版本</dt>
          <dd>{{ version ? `v${version}` : '—' }}</dd>
        </div>
        <div class="fact">
          <dt>上次同步</dt>
          <dd>{{ formatTime(lastSyncAt) }}</dd>
        </div>
        <div class="fact">
          <dt>本地数据</dt>
          <dd>{{ balls.length }} 条彩球 · {{ advanced.length }} 条进阶</dd>
        </div>
      </dl>

      <div class="block__actions">
        <el-button type="primary" :loading="syncingNow || syncing" @click="onSync">
          立即同步
        </el-button>
        <span class="block__state">{{ syncStateText() }}</span>
      </div>
    </article>

    <!-- 系统（T10.1，D36）：托盘与关闭行为 -->
    <article v-if="prefsReady" class="card block">
      <h2 class="block__title">系统</h2>
      <p class="block__hint">关闭窗口时怎么办。</p>

      <el-radio-group
        :model-value="closeAction"
        @change="(value: CloseAction) => onCloseActionChange(value)"
      >
        <el-radio-button v-for="option in CLOSE_OPTIONS" :key="option.value" :value="option.value">
          {{ option.label }}
        </el-radio-button>
      </el-radio-group>
      <p class="block__hint">
        {{
          closeAction === 'tray'
            ? '关闭窗口后程序留在后台，点托盘图标就能叫回来；要彻底退出用托盘菜单里的「退出」。'
            : '关闭窗口即结束程序，下次要重新打开。'
        }}
      </p>

      <div class="block__row">
        <span class="block__row-label">开机自动启动</span>
        <el-switch
          :model-value="autoStart"
          :disabled="!autoStartSupported"
          @change="onAutoStartChange"
        />
      </div>
      <p class="block__hint">
        {{
          autoStartSupported
            ? '开机时随 Windows 一起启动，启动后直接进托盘，不弹窗口。'
            : '开发模式下不写系统启动项，装成安装包之后才会生效。'
        }}
      </p>
    </article>

    <!-- 版本与关于 -->
    <article class="card block">
      <h2 class="block__title">版本与关于</h2>

      <dl class="facts">
        <div class="fact">
          <dt>应用版本</dt>
          <dd>{{ appInfo?.version ?? '—' }}</dd>
        </div>
        <div class="fact">
          <dt>Electron</dt>
          <dd>{{ appInfo?.electron ?? '—' }}</dd>
        </div>
        <div class="fact">
          <dt>Chromium</dt>
          <dd>{{ appInfo?.chrome ?? '—' }}</dd>
        </div>
        <div class="fact">
          <dt>Node</dt>
          <dd>{{ appInfo?.node ?? '—' }}</dd>
        </div>
      </dl>

      <!-- 日志（T6.2）：出问题时唯一需要看的东西 -->
      <p class="log-line">
        <span class="log-line__label">日志文件</span>
        <span class="log-line__path" :title="logPath">{{ logPath || '还没有生成' }}</span>
      </p>
      <div class="block__actions">
        <el-button size="small" :disabled="!logPath" @click="onOpenLog">打开日志文件夹</el-button>
        <el-button size="small" :disabled="!logPath" @click="onCopyLogPath">复制路径</el-button>
        <span class="block__state">程序出错时，把 main.log 发过来就能定位</span>
      </div>

      <p class="about">
        作者：酸菜黄花鱼 · 联系方式 QQ 78260590<br />
        本程序用于学习斯诺克走位技巧，仅供内部交流使用。
      </p>
    </article>
  </section>
</template>

<style scoped>
.settings {
  display: flex;
  flex-direction: column;
  gap: 0.875rem;
  padding: clamp(16px, 2.2vw, 28px);
}

.settings__title {
  margin: 0;
  font-size: clamp(1.25rem, 1.6vw, 1.5rem);
  font-weight: 500;
  color: var(--text-1);
}

.block {
  padding: clamp(1rem, 1.8vw, 1.5rem);
}

.block__title {
  margin: 0;
  font-size: var(--font-size-lg);
  font-weight: 500;
  color: var(--text-1);
}

.block__hint {
  margin: 0.375rem 0 0;
  font-size: var(--font-size-sm);
  line-height: 1.8;
  color: var(--text-3);
}

.facts {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(10rem, 1fr));
  gap: 0.75rem 1.5rem;
  margin: 1rem 0 0;
}

.fact {
  display: flex;
  flex-direction: column;
  gap: 0.125rem;
}

.fact dt {
  font-size: var(--font-size-sm);
  color: var(--text-3);
}

.fact dd {
  margin: 0;
  font-size: var(--font-size-sm);
  font-variant-numeric: tabular-nums;
  color: var(--text-1);
}

.block__actions {
  display: flex;
  gap: 0.75rem;
  align-items: center;
  margin-top: 1rem;
}

.block__state {
  font-size: var(--font-size-sm);
  color: var(--text-2);
}

/* 开关行：左边说明、右边开关，与上面的单选分组共用卡片布局 */
.block__row {
  display: flex;
  gap: 0.75rem;
  align-items: center;
  justify-content: space-between;
  margin-top: 0.875rem;
  padding: 0.5rem 0.625rem;
  background: var(--surface-2);
  border-radius: var(--radius-sm);
}

.block__row-label {
  font-size: var(--font-size-sm);
  color: var(--text-1);
}

/* 日志路径可能很长：单行省略，完整路径放 title，需要时点「复制路径」 */
.log-line {
  display: flex;
  gap: 0.5rem;
  align-items: baseline;
  margin: 1rem 0 0;
  font-size: var(--font-size-sm);
  min-width: 0;
}

.log-line__label {
  flex: 0 0 auto;
  color: var(--text-3);
}

.log-line__path {
  overflow: hidden;
  color: var(--text-2);
  font-variant-numeric: tabular-nums;
  text-overflow: ellipsis;
  white-space: nowrap;
  /* 复制失败时提示"手动选中"，所以这里必须真的能选中 */
  user-select: text;
}

.about {
  margin: 1rem 0 0;
  font-size: var(--font-size-sm);
  line-height: 2;
  color: var(--text-2);
}
</style>
