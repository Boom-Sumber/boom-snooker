<script setup lang="ts">
/**
 * 系统设置（T3.7，2026-11-04 重排版）
 *
 * 排版约定（改之前先看这段）：
 *   - 四段：外观 / 启动与关闭 / 数据与缓存 / 版本与更新
 *   - 每段内部一律「左侧标题 + 说明，右侧控件」的行式布局，行与行之间只用一条
 *     分隔线，**不给行加背景色块**（原来灰底小块堆着看很乱）
 *   - 只有两种状态的设置一律用开关（缩到托盘 / 开机自启），三选一的主题用分段按钮
 *
 * 版本号从主进程 `app:info` 拿，不写死：写死的话每次发版都要改代码。
 */
import { computed, onMounted, onUnmounted, ref } from 'vue'
import { ElMessage, ElMessageBox } from 'element-plus'
import { storeToRefs } from 'pinia'
import { useDatasetStore, useThemeStore, useUpdateStore } from '@renderer/stores'
import { POEM_CATEGORIES } from '@renderer/services/poemLibrary'
import type { AppInfo } from '@shared/types/app'
import {
  START_PAGE_DEFAULT_SECONDS,
  START_PAGE_MAX_SECONDS,
  START_PAGE_MIN_SECONDS,
  type CloseAction,
  type StartPagePreferences
} from '@shared/types/system'
import type { MediaCacheStats, PrefetchProgress } from '@shared/types/media'
import type { ThemeMode } from '@shared/types/theme'

const theme = useThemeStore()
const dataset = useDatasetStore()
const update = useUpdateStore()
const { balls, advanced, version, lastSyncAt, syncing, progress, syncState } = storeToRefs(dataset)

const appInfo = ref<AppInfo | null>(null)
const syncingNow = ref(false)
/** 日志文件路径（T6.2）：排查问题时让用户直接打开/复制，不用教他去找 %APPDATA% */
const logPath = ref('')

/** 本机偏好（T10.1）：关闭窗口是缩到托盘还是直接退出 */
const closeAction = ref<CloseAction>('tray')
const prefsReady = ref(false)

/** 启动页偏好（2026-11-05：显示与否 / 手动进入 / 自动进入秒数 / 诗句类别） */
const startPage = ref<StartPagePreferences>({
  enabled: true,
  manualEnter: false,
  autoEnterSeconds: START_PAGE_DEFAULT_SECONDS,
  poemCategories: []
})

/** 开机自启（T10.2）：状态以系统返回为准；dev 下不支持，开关置灰 */
const autoStart = ref(false)
const autoStartSupported = ref(false)

/* ── 资源缓存（T10.3） ── */

const cacheStats = ref<MediaCacheStats>({ files: 0, bytes: 0 })
const prefetchVisible = ref(false)
const prefetching = ref(false)
const prefetchDone = ref(false)
const prefetchProgress = ref<PrefetchProgress>({
  total: 0,
  done: 0,
  downloaded: 0,
  skipped: 0,
  failed: 0
})

/** 快照里所有唯一的图片路径（三张球图 + 进阶一张图），去重后交给主进程 */
const uniqueImagePaths = computed<string[]>(() => {
  const set = new Set<string>()
  for (const ball of balls.value) {
    for (const path of [ball.impact_image, ball.blue_image, ball.route_image]) {
      if (path) set.add(path)
    }
  }
  for (const item of advanced.value) {
    if (item.image) set.add(item.image)
  }
  return [...set]
})

const prefetchPercent = computed(() => {
  const { total, done } = prefetchProgress.value
  if (total === 0) return 0
  return Math.min(100, Math.round((done / total) * 100))
})

function sizeText(bytes: number): string {
  if (!bytes) return '0 B'
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`
}

async function refreshCacheStats(): Promise<void> {
  try {
    cacheStats.value = await window.api.media.stats()
  } catch {
    // 拿不到就保持旧值，不影响别的设置
  }
}

const THEME_OPTIONS: { value: ThemeMode; label: string; hint: string }[] = [
  { value: 'light', label: '亮色', hint: '白天用' },
  { value: 'dark', label: '暗色', hint: '夜里不刺眼' },
  { value: 'system', label: '跟随系统', hint: '系统切换时跟着变' }
]

/** 主题当前选项的一句说明：换选项时跟着变，不再固定占两行 */
const themeHint = computed(
  () => THEME_OPTIONS.find((item) => item.value === theme.mode)?.hint ?? '切换立即生效'
)

function formatTime(raw: number | null): string {
  if (!raw) return '—'
  const date = new Date(raw)
  if (Number.isNaN(date.getTime())) return '—'
  const pad = (n: number): string => String(n).padStart(2, '0')
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())} ${pad(date.getHours())}:${pad(date.getMinutes())}`
}

/** 同步状态 → 一句人话 */
function syncStateText(): string {
  // `syncing` 也要算：启动时 dataset.init() 会自己同步一次，
  // 那时候 syncingNow（只代表本页手动点过按钮）还是 false
  if (syncingNow.value || syncing.value) return progress.value?.message ?? '同步中…'
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

/** 数据同步那一行的说明：快照 / 条数 / 上次同步，用间距分隔，不再摆一张信息表格 */
const syncSummary = computed(() => {
  const parts = [
    version.value ? `快照 v${version.value}` : '快照 —',
    `${balls.value.length} 条彩球`,
    `${advanced.value.length} 条进阶`,
    `上次同步 ${formatTime(lastSyncAt.value)}`
  ]
  return parts.join(' · ')
})

const cacheSummary = computed(() => {
  const { files, bytes } = cacheStats.value
  const total = uniqueImagePaths.value.length
  return `本地已缓存 ${files} 张（${sizeText(bytes)}）· 共 ${total} 张`
})

/** 关闭行为用开关表示：开 = 缩到托盘，关 = 直接退出 */
const closeToTray = computed(() => closeAction.value === 'tray')

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
 * 改开机自启（T10.2）
 *
 * 以主进程返回的**实际值**为准：系统可能拒绝写入（权限/策略），
 * 那时候开关要弹回去，不能显示一个假的成功。
 */
async function onAutoStartChange(value: string | number | boolean): Promise<void> {
  try {
    const state = await window.api.system.autostart.set(value === true)
    autoStart.value = state.enabled
    autoStartSupported.value = state.supported
    // 系统没接受（权限/策略）：开关要弹回去，不能显示一个假的成功
    if (state.enabled !== (value === true)) {
      autoStart.value = state.enabled
      ElMessage.error('设置保存失败')
    }
  } catch {
    ElMessage.error('设置保存失败')
  }
}

/**
 * 改关闭行为（T10.1）
 *
 * 先改内存让用户立刻看到反馈，再落盘；主进程写失败也不会让界面跳回去 ——
 * 偏好文件写不进去只是"下次启动不记得"，本次会话仍然按用户的选择走。
 */
async function onCloseActionChange(value: CloseAction): Promise<void> {
  closeAction.value = value
  try {
    await window.api.system.setPrefs({ closeAction: value })
  } catch {
    ElMessage.error('设置保存失败')
  }
}

function onCloseToTrayChange(value: string | number | boolean): void {
  void onCloseActionChange(value === true ? 'tray' : 'quit')
}

/**
 * 存启动页偏好
 *
 * ⚠️ 2026-11-05 修 bug：原来写的是 `{ ...startPage.value, ...patch }`，
 * 浅拷贝会把 ref 里的 **reactive 数组代理**原样塞进 IPC 参数，
 * 结构化克隆失败（`An object could not be cloned`）→ 所有启动页设置都存不进去。
 * 现在显式拆成基本值 + 新数组，保证是可克隆的普通对象。
 *
 * 主进程会再夹一次范围（5~60 秒），这里夹只是为了让界面立刻显示合法值。
 */
async function saveStartPage(patch: Partial<StartPagePreferences>): Promise<void> {
  const next: StartPagePreferences = {
    enabled: patch.enabled ?? startPage.value.enabled,
    manualEnter: patch.manualEnter ?? startPage.value.manualEnter,
    autoEnterSeconds: patch.autoEnterSeconds ?? startPage.value.autoEnterSeconds,
    poemCategories: [...(patch.poemCategories ?? startPage.value.poemCategories)]
  }
  startPage.value = next
  try {
    await window.api.system.setPrefs({ startPage: next })
  } catch {
    ElMessage.error('设置保存失败')
  }
}

function onStartPageToggle(value: string | number | boolean): void {
  void saveStartPage({ enabled: value === true })
}

function onManualEnterToggle(value: string | number | boolean): void {
  void saveStartPage({ manualEnter: value === true })
}

function onAutoEnterChange(value: number | undefined): void {
  if (typeof value !== 'number' || Number.isNaN(value)) return
  const clamped = Math.min(
    START_PAGE_MAX_SECONDS,
    Math.max(START_PAGE_MIN_SECONDS, Math.round(value))
  )
  void saveStartPage({ autoEnterSeconds: clamped })
}

function onCategoriesChange(value: string[]): void {
  void saveStartPage({ poemCategories: [...value] })
}

/** 全量缓存（T10.3）：开弹框 → 让主进程按 5 并发下载 → 进度靠 IPC 推回来 */
async function onPrefetch(): Promise<void> {
  if (prefetching.value) return

  const paths = uniqueImagePaths.value
  if (paths.length === 0) {
    ElMessage.warning('还没有可缓存的图片，先同步一次数据')
    return
  }

  prefetchProgress.value = { total: paths.length, done: 0, downloaded: 0, skipped: 0, failed: 0 }
  prefetching.value = true
  prefetchDone.value = false
  prefetchVisible.value = true

  try {
    const result = await window.api.media.prefetch(paths)
    if (!result.ok || !result.data) {
      ElMessage.error(result.message ?? '缓存失败')
      return
    }

    const { failed, cancelled } = result.data
    if (cancelled) ElMessage.info('已取消，已下载的图片保留在本地')
    else if (failed > 0) ElMessage.warning(`缓存完成，${failed} 张失败（可能断网或图片缺失）`)
    else ElMessage.success('全部缓存完成，断网也能正常看图')
  } catch {
    ElMessage.error('缓存失败')
  } finally {
    prefetching.value = false
    prefetchDone.value = true
    await refreshCacheStats()
  }
}

async function onCancelPrefetch(): Promise<void> {
  try {
    await window.api.media.cancelPrefetch()
  } catch {
    // 取消失败也只是继续下载，不打断用户
  }
}

async function onClearCache(): Promise<void> {
  try {
    await ElMessageBox.confirm(
      `将删除本地缓存的 ${cacheStats.value.files} 张图片（${sizeText(cacheStats.value.bytes)}）。` +
        '删除后再次浏览会重新从服务器下载，不影响记录本身。',
      '清空图片缓存？',
      { confirmButtonText: '清空', cancelButtonText: '取消', type: 'warning' }
    )
  } catch {
    return
  }

  try {
    cacheStats.value = await window.api.media.clear()
    if (cacheStats.value.files > 0) {
      // 有文件被占用（比如刚打开的图还在读），不能假装成功
      ElMessage.warning(`还有 ${cacheStats.value.files} 张没删掉，稍后再试一次`)
    } else {
      ElMessage.success('已清空图片缓存')
    }
  } catch {
    ElMessage.error('清空失败')
  }
}

/** 进度订阅的取消函数（组件卸载时解绑，避免重复订阅） */
let offProgress: (() => void) | null = null

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
    startPage.value = {
      enabled: prefs.startPage.enabled !== false,
      manualEnter: prefs.startPage.manualEnter === true,
      autoEnterSeconds: prefs.startPage.autoEnterSeconds,
      // 旧版本存的是另一套类别 code（tangshi / lizhi / chuci…），
      // 换数据源后这些 code 已经不存在，留着会让下拉框显示一堆无效值
      poemCategories: prefs.startPage.poemCategories.filter((code) =>
        POEM_CATEGORIES.some((item) => item.code === code)
      )
    }
    // 上一步过滤掉的就顺手写回去，别每次都过滤一遍
    if (startPage.value.poemCategories.length !== prefs.startPage.poemCategories.length) {
      void window.api.system.setPrefs({
        startPage: {
          ...startPage.value,
          poemCategories: [...startPage.value.poemCategories]
        }
      })
    }
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

  void refreshCacheStats()

  // 进度由主进程推（长任务拿不到 invoke 的中间态）
  offProgress = window.api.media.onProgress((next) => {
    prefetchProgress.value = next
  })
})

onUnmounted(() => {
  offProgress?.()
  offProgress = null
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

/* ── 应用更新（U3） ── */

/**
 * 状态文案
 *
 * 一律从 store 的 phase 派生，不另存一份 —— 主进程是唯一真源，
 * 这里多存一份就会出现"显示已是最新、其实正在下载"这种自相矛盾。
 */
const updateStatusText = computed<string>(() => {
  const state = update.state

  if (state.phase === 'unsupported') {
    return state.unsupportedReason ?? '当前环境不支持应用内更新'
  }
  if (state.phase === 'checking') return '正在检查…'
  if (state.phase === 'downloading')
    return `正在下载 v${state.info?.version ?? ''}（${update.percent}%）`
  if (state.phase === 'downloaded') {
    return `v${state.info?.version ?? ''} 已下载完成，重启后自动安装`
  }
  if (state.phase === 'available') {
    return state.mandatory
      ? `必须更新到 v${state.info?.version ?? ''}，当前版本已停止支持`
      : `发现新版本 v${state.info?.version ?? ''}`
  }
  if (state.phase === 'not-available') return '已是最新版本'
  if (state.phase === 'error') return `出错了：${state.error ?? '原因未知'}`
  return state.checkedAt ? '启动后会自动检查一次，也可以现在检查' : '启动后会自动检查一次'
})

const updateMeta = computed(() => {
  const checked = update.state.checkedAt
    ? `上次检查 ${formatTime(update.state.checkedAt)}`
    : '还没检查过'
  return update.info?.size ? `${checked} · 安装包 ${sizeText(update.info.size)}` : checked
})

async function onCheckUpdate(): Promise<void> {
  try {
    const state = await update.check()
    if (state.phase === 'not-available') ElMessage.success('已经是最新版本')
    else if (state.phase === 'available') ElMessage.success(`发现新版本 v${state.info?.version}`)
    else if (state.phase === 'error') ElMessage.error(state.error ?? '检查失败')
  } catch {
    ElMessage.error('检查更新失败')
  }
}

async function onDownloadUpdate(): Promise<void> {
  try {
    await update.download()
  } catch {
    ElMessage.error('下载没能开始，稍后再试')
  }
}

async function onCancelUpdate(): Promise<void> {
  await update.cancel()
}

async function onInstallUpdate(): Promise<void> {
  await update.install()
}
</script>

<template>
  <section class="settings">
    <h1 class="settings__title">系统设置</h1>

    <!-- 外观 -->
    <article class="card panel">
      <h2 class="panel__title">外观</h2>

      <div class="row">
        <div class="row__text">
          <p class="row__label">主题</p>
          <p class="row__desc">切换立即生效，不用重启 · {{ themeHint }}</p>
        </div>
        <div class="row__control">
          <el-radio-group :model-value="theme.mode" @change="onThemeChange">
            <el-radio-button
              v-for="option in THEME_OPTIONS"
              :key="option.value"
              :value="option.value"
            >
              {{ option.label }}
            </el-radio-button>
          </el-radio-group>
        </div>
      </div>
    </article>

    <!-- 启动页（2026-11-05）：显示与否 / 手动进入 / 自动进入秒数 / 诗句类别 -->
    <article v-if="prefsReady" class="card panel">
      <h2 class="panel__title">启动页</h2>

      <div class="row">
        <div class="row__text">
          <p class="row__label">启动时显示启动页</p>
          <p class="row__desc">关掉后打开程序直接进主页，不再停留在标题与诗句那一屏。</p>
        </div>
        <div class="row__control">
          <el-switch :model-value="startPage.enabled" @change="onStartPageToggle" />
        </div>
      </div>

      <div class="row">
        <div class="row__text">
          <p class="row__label">手动进入主页</p>
          <p class="row__desc">
            开启后不显示倒计时，必须自己点「开始」；关闭则读秒结束自动进主页。
          </p>
        </div>
        <div class="row__control">
          <el-switch
            :model-value="startPage.manualEnter"
            :disabled="!startPage.enabled"
            @change="onManualEnterToggle"
          />
        </div>
      </div>

      <div class="row">
        <div class="row__text">
          <p class="row__label">自动进入倒计时</p>
          <p class="row__desc">
            {{
              startPage.manualEnter
                ? '手动进入模式不需要倒计时。'
                : '启动页停留这么久后自己进主页（最少 5 秒）；想早点进去点「开始」即可。'
            }}
          </p>
        </div>
        <div class="row__control">
          <el-input-number
            class="seconds-input"
            :model-value="startPage.autoEnterSeconds"
            :min="START_PAGE_MIN_SECONDS"
            :max="START_PAGE_MAX_SECONDS"
            :step="1"
            step-strictly
            controls-position="right"
            :disabled="!startPage.enabled || startPage.manualEnter"
            @change="onAutoEnterChange"
          />
          <span class="row__unit">秒</span>
        </div>
      </div>

      <div class="row">
        <div class="row__text">
          <p class="row__label">诗句类别</p>
          <p class="row__desc">
            可以多选。不选 = 不限（在线随机）；选了就按这些体裁取诗，断网时用本地缓存。
          </p>
        </div>
        <div class="row__control">
          <el-select
            class="category-select"
            :model-value="startPage.poemCategories"
            multiple
            collapse-tags
            collapse-tags-tooltip
            placeholder="不限（在线随机）"
            :disabled="!startPage.enabled"
            @change="onCategoriesChange"
          >
            <el-option
              v-for="category in POEM_CATEGORIES"
              :key="category.code"
              :label="category.label"
              :value="category.code"
            />
          </el-select>
        </div>
      </div>
    </article>

    <!-- 启动与关闭（T10.1 / T10.2，D36） -->
    <article v-if="prefsReady" class="card panel">
      <h2 class="panel__title">启动与关闭</h2>

      <div class="row">
        <div class="row__text">
          <p class="row__label">开机自动启动</p>
          <p class="row__desc">
            {{
              autoStartSupported
                ? '开机时随 Windows 一起启动，启动后直接进托盘，不弹窗口。'
                : '仅安装版可设置；当前是开发模式，不会写系统启动项。'
            }}
          </p>
        </div>
        <div class="row__control">
          <el-switch
            :model-value="autoStart"
            :disabled="!autoStartSupported"
            @change="onAutoStartChange"
          />
        </div>
      </div>

      <div class="row">
        <div class="row__text">
          <p class="row__label">关闭窗口时缩到托盘</p>
          <p class="row__desc">
            {{
              closeToTray
                ? '关闭后程序留在后台，点托盘图标能叫回来；要彻底退出用托盘菜单的「退出」。'
                : '关闭窗口即结束程序，下次要重新打开。'
            }}
          </p>
        </div>
        <div class="row__control">
          <el-switch :model-value="closeToTray" @change="onCloseToTrayChange" />
        </div>
      </div>
    </article>

    <!-- 数据与缓存 -->
    <article class="card panel">
      <h2 class="panel__title">数据与缓存</h2>

      <div class="row">
        <div class="row__text">
          <p class="row__label">数据同步</p>
          <p class="row__desc">{{ syncSummary }} · {{ syncStateText() }}</p>
          <!-- 快照走 RPC 拿不到 Content-Length，进度按阶段折算（T6.4） -->
          <el-progress
            v-if="syncingNow || syncing"
            class="row__progress"
            :percentage="progress?.percent ?? 0"
            :stroke-width="6"
            :show-text="false"
          />
        </div>
        <div class="row__control">
          <el-button type="primary" :loading="syncingNow || syncing" @click="onSync">
            立即同步
          </el-button>
        </div>
      </div>

      <div class="row">
        <div class="row__text">
          <p class="row__label">图片缓存</p>
          <p class="row__desc">
            {{ cacheSummary }}。图片默认是看到哪张下哪张，全部缓存后断网也能翻图。
          </p>
        </div>
        <div class="row__control">
          <el-button :loading="prefetching" @click="onPrefetch">全量缓存</el-button>
          <el-button :disabled="prefetching || cacheStats.files === 0" @click="onClearCache">
            清空
          </el-button>
        </div>
      </div>
    </article>

    <!-- 版本与更新 -->
    <article class="card panel">
      <h2 class="panel__title">版本与更新</h2>

      <div class="row">
        <div class="row__text">
          <p class="row__label">应用更新</p>
          <p class="row__desc" :class="{ 'row__desc--error': update.phase === 'error' }">
            {{ updateStatusText }}
          </p>
          <el-progress
            v-if="update.phase === 'downloading'"
            class="row__progress"
            :percentage="update.percent"
            :stroke-width="6"
          />
          <p class="row__meta">{{ updateMeta }}</p>
        </div>
        <div class="row__control">
          <el-button v-if="update.phase === 'downloaded'" type="primary" @click="onInstallUpdate">
            重启并安装
          </el-button>
          <el-button v-else-if="update.phase === 'downloading'" @click="onCancelUpdate">
            取消下载
          </el-button>
          <el-button
            v-else-if="update.phase === 'available'"
            type="primary"
            :loading="update.busy"
            @click="onDownloadUpdate"
          >
            下载更新
          </el-button>
          <el-button
            v-else
            :disabled="!update.canCheck"
            :loading="update.busy"
            @click="onCheckUpdate"
          >
            检查更新
          </el-button>
        </div>
      </div>

      <!-- 日志（T6.2）：出问题时唯一需要看的东西 -->
      <div class="row">
        <div class="row__text">
          <p class="row__label">日志文件</p>
          <p class="row__desc row__desc--path" :title="logPath">
            {{ logPath || '还没有生成，程序运行后才会创建' }}
          </p>
        </div>
        <div class="row__control">
          <el-button :disabled="!logPath" @click="onOpenLog">打开文件夹</el-button>
          <el-button :disabled="!logPath" @click="onCopyLogPath">复制路径</el-button>
        </div>
      </div>

      <p class="panel__foot">
        版本 {{ appInfo?.version ?? '—' }} · Electron {{ appInfo?.electron ?? '—' }} · Chromium
        {{ appInfo?.chrome ?? '—' }} · Node {{ appInfo?.node ?? '—' }}
      </p>
      <p class="panel__foot panel__foot--about">
        作者：酸菜黄花鱼 · 联系方式 QQ 78260590 · 本程序用于学习斯诺克走位，仅供内部交流。
      </p>
    </article>

    <!-- 全量缓存进度（T10.3）：缓存期间不给关，避免"以为没在跑" -->
    <el-dialog
      v-model="prefetchVisible"
      :title="prefetchDone ? '缓存完成' : '正在缓存图片'"
      width="420px"
      :close-on-click-modal="false"
      :show-close="false"
      append-to-body
    >
      <el-progress
        :percentage="prefetchPercent"
        :status="prefetchDone ? (prefetchProgress.failed > 0 ? 'warning' : 'success') : undefined"
      />
      <p class="prefetch__line">
        已处理 {{ prefetchProgress.done }} / {{ prefetchProgress.total }} 张
      </p>
      <p class="prefetch__line prefetch__line--muted">
        新下载 {{ prefetchProgress.downloaded }} · 已有 {{ prefetchProgress.skipped }} · 失败
        {{ prefetchProgress.failed }}
      </p>

      <template #footer>
        <el-button v-if="!prefetchDone" @click="onCancelPrefetch">取消</el-button>
        <el-button v-else type="primary" @click="prefetchVisible = false">知道了</el-button>
      </template>
    </el-dialog>
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

.panel {
  padding: clamp(1rem, 1.8vw, 1.5rem);
}

.panel__title {
  margin: 0 0 0.25rem;
  font-size: var(--font-size-base);
  font-weight: 500;
  color: var(--text-2);
}

/* ---------- 设置行：左说明 + 右控件，只用分隔线，不加背景 ---------- */

.row {
  display: flex;
  flex-wrap: wrap;
  gap: 0.75rem 1.5rem;
  align-items: center;
  justify-content: space-between;
  padding: 0.875rem 0;
}

.row + .row {
  border-top: 1px solid var(--border);
}

.row__text {
  flex: 1 1 18rem;
  min-width: 0;
}

.row__label {
  margin: 0;
  font-size: var(--font-size-base);
  color: var(--text-1);
}

.row__desc {
  margin: 0.25rem 0 0;
  font-size: var(--font-size-sm);
  line-height: 1.7;
  color: var(--text-2);
}

.row__desc--error {
  color: var(--danger);
}

/* 日志路径可能很长：单行省略，完整路径放 title，需要时点「复制路径」 */
.row__desc--path {
  overflow: hidden;
  font-variant-numeric: tabular-nums;
  text-overflow: ellipsis;
  white-space: nowrap;
  /* 复制失败时提示"手动选中"，所以这里必须真的能选中 */
  user-select: text;
}

.row__meta {
  margin: 0.125rem 0 0;
  font-size: var(--font-size-sm);
  color: var(--text-3);
  font-variant-numeric: tabular-nums;
}

.row__progress {
  margin-top: 0.5rem;
}

.row__control {
  display: flex;
  flex: 0 0 auto;
  flex-wrap: wrap;
  gap: 0.5rem;
  align-items: center;
  justify-content: flex-end;
}

/* 秒数输入与类别下拉：固定一个不随窗口乱跳的宽度 */
.seconds-input {
  width: 7.5rem;
}

.row__unit {
  font-size: var(--font-size-sm);
  color: var(--text-2);
}

.category-select {
  width: 16rem;
}

/* ---------- 卡片底部：版本号与作者信息 ---------- */

.panel__foot {
  margin: 0.75rem 0 0;
  padding-top: 0.75rem;
  font-size: var(--font-size-sm);
  color: var(--text-3);
  border-top: 1px solid var(--border);
  font-variant-numeric: tabular-nums;
}

.panel__foot--about {
  margin-top: 0.375rem;
  padding-top: 0;
  border-top: 0;
  line-height: 1.9;
}

/* ---------- 缓存进度弹框 ---------- */

.prefetch__line {
  margin: 0.75rem 0 0;
  font-size: var(--font-size-sm);
  color: var(--text-1);
  font-variant-numeric: tabular-nums;
}

.prefetch__line--muted {
  margin-top: 0.25rem;
  color: var(--text-3);
}
</style>
