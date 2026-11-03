/**
 * 更新 store（U3）
 *
 * 渲染层只做一件事：把主进程推来的快照**原样**存下来。
 * 这里不推导 `mandatory`、不自己算"有没有新版"—— 那些判断都在 `src/main/updater.ts`，
 * 渲染层再算一遍就会出现"设置页说有新版、侧栏红点没亮"的分裂。
 *
 * 订阅只在 `init()` 里建一次，由 `bootstrapStores()` 调用：
 * 侧栏红点、设置页、强制弹窗三个地方共用同一份状态和同一个 IPC 监听，
 * 各自 `onState` 会让同一份快照被处理三遍，还漏不掉退订。
 */
import { defineStore } from 'pinia'
import { computed, ref } from 'vue'
import type { UpdatePhase, UpdateState } from '@shared/types/update'

/** 出现这三个阶段就说明"线上有更新的版本"，红点/托盘提示都以此为准 */
const HAS_UPDATE_PHASES: UpdatePhase[] = ['available', 'downloading', 'downloaded']

/** 主进程还没回话之前的占位。`currentVersion` 留空，界面显示 "—" 而不是假的 0.0.0 */
const INITIAL_STATE: UpdateState = {
  phase: 'idle',
  currentVersion: '',
  info: null,
  progress: null,
  mandatory: false,
  minSupportedVersion: null,
  error: null,
  checkedAt: null,
  unsupportedReason: null
}

export const useUpdateStore = defineStore('update', () => {
  const state = ref<UpdateState>({ ...INITIAL_STATE })

  /** 手动操作（检查/下载/取消）进行中：按钮转圈用，与主进程的 phase 不是一回事 */
  const busy = ref(false)

  /** 是否已建立订阅；`init()` 幂等靠它 */
  let off: (() => void) | null = null

  const phase = computed(() => state.value.phase)
  const info = computed(() => state.value.info)
  const progress = computed(() => state.value.progress)

  /** 线上有新版（含已下载完）：侧栏红点、设置页文案都看这个 */
  const hasUpdate = computed(() => HAS_UPDATE_PHASES.includes(state.value.phase))

  /**
   * 强制更新 + 有新版 → 唯一会弹窗的组合
   *
   * `error` 也算在内：强制更新的意思是"不更新就别用"，下载失败时如果直接放行，
   * 用户点一下重试失败就绕过去了。弹窗会改成「重试 / 退出程序」两条路。
   */
  const showForcedDialog = computed(
    () =>
      state.value.mandatory &&
      state.value.info !== null &&
      (hasUpdate.value || state.value.phase === 'error')
  )

  /** 当前环境压根不支持更新（dev / 缺配置文件）：按钮置灰并给出原因 */
  const unsupported = computed(() => state.value.phase === 'unsupported')

  /** 下载百分比：主进程已经取整，这里只在缺进度时兜底 0 */
  const percent = computed(() => state.value.progress?.percent ?? 0)

  /** 检查按钮能不能点：正在下载时点它没有意义，还会打断进度 */
  const canCheck = computed(
    () => !unsupported.value && !busy.value && state.value.phase !== 'downloading'
  )

  async function init(): Promise<void> {
    if (off) return

    // 先拉一次快照再订阅：反过来的话，两次之间发生的状态变化会被漏掉
    try {
      state.value = await window.api.updater.state()
    } catch {
      // 主进程没注册（理论上不会）：保持初始态，界面显示不支持更新
    }

    off = window.api.updater.onState((next) => {
      state.value = next
    })
  }

  /** 手动检查：失败原因由主进程写进 `error`，这里只负责转圈和把错误抛给调用方 */
  async function check(): Promise<UpdateState> {
    if (busy.value) return state.value
    busy.value = true
    try {
      state.value = await window.api.updater.check()
      return state.value
    } finally {
      busy.value = false
    }
  }

  async function download(): Promise<UpdateState> {
    if (busy.value) return state.value
    busy.value = true
    try {
      state.value = await window.api.updater.download()
      return state.value
    } finally {
      busy.value = false
    }
  }

  /** 取消下载：状态回到 available，已下载的分片保留（下次续着来） */
  async function cancel(): Promise<void> {
    try {
      state.value = await window.api.updater.cancel()
    } catch {
      // 取消失败不打断用户，顶多继续下载
    }
  }

  /** 退出并安装。调用后进程会被主进程关掉，不要再 await 后续逻辑 */
  async function install(): Promise<void> {
    await window.api.updater.install()
  }

  return {
    state,
    busy,
    phase,
    info,
    progress,
    hasUpdate,
    showForcedDialog,
    unsupported,
    percent,
    canCheck,
    init,
    check,
    download,
    cancel,
    install
  }
})
