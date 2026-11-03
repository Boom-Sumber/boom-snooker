/**
 * 网络状态（T6.1）
 *
 * 离线判定由两个信号叠加：
 *   ① `browserOnline`   —— `navigator.onLine`，网卡有没有连上
 *   ② `serverReachable` —— 最近一次跟 Supabase 打交道的结果
 *
 * 为什么不能只用其中一个：
 *   · 只看 `navigator.onLine`：连着路由器但出口不通、代理挂了、Supabase 自己 502 时
 *     它仍然是 true，界面显示"在线"，然后每次操作都报错
 *   · 只看服务端探测：首次启动还没同步过时是 unknown，断网那一刻界面不会提示
 *
 * 状态由**同步结果**驱动（`dataset.sync()` 结束后回报），不在这一层发请求 ——
 * 避免出现"网络层自己探测、数据层自己同步"两条互不相干的请求链。
 */
import { defineStore } from 'pinia'
import { computed, ref } from 'vue'
import { isBrowserOnline } from '@shared/net/online'
import type { SyncStatus } from '@shared/sync/snapshot'

/** 离线原因：文案与按钮提示据此区分 */
export type OfflineReason = 'disconnected' | 'unreachable'

/** 服务端不可达时的自动重试间隔：一次只是一条 `get_dataset_version`，很便宜 */
const AUTO_RETRY_MS = 30_000

export const useNetworkStore = defineStore('network', () => {
  /** 网卡层面有没有连上（`online` / `offline` 事件实时更新） */
  const browserOnline = ref(isBrowserOnline())
  /** 最近一次请求服务端的结果：null = 还没试过 */
  const serverReachable = ref<boolean | null>(null)
  /** 正在手动/自动重试，按钮用来转圈 */
  const retrying = ref(false)
  /** 最近一次确认可用的时间戳，提示条里显示"刚刚/几分钟前" */
  const lastReachableAt = ref<number | null>(null)

  /** 统一的"现在算不算离线" —— 界面所有禁用逻辑都读这一个值 */
  const offline = computed(() => !browserOnline.value || serverReachable.value === false)

  const reason = computed<OfflineReason | null>(() => {
    if (!browserOnline.value) return 'disconnected'
    if (serverReachable.value === false) return 'unreachable'
    return null
  })

  /** 重试动作由 `bootstrapStores()` 注入（这里 import dataset store 会形成循环依赖） */
  let retryHandler: (() => Promise<unknown>) | null = null
  let timer: number | undefined
  let started = false

  function setRetryHandler(handler: () => Promise<unknown>): void {
    retryHandler = handler
  }

  /**
   * 同步结果回报
   *
   * `offline` 是唯一能证明"服务端不可达"的状态；`error` 说明服务端有响应
   * （只是返回了结构异常），所以仍然算可达 —— 否则一次脏数据会误报离线。
   */
  function reportSyncResult(status: SyncStatus): void {
    if (status === 'offline') {
      serverReachable.value = false
      return
    }
    serverReachable.value = true
    lastReachableAt.value = Date.now()
  }

  /** 手动重试（提示条按钮）；返回是否已恢复 */
  async function retry(): Promise<boolean> {
    if (retrying.value || !retryHandler) return !offline.value
    retrying.value = true
    try {
      await retryHandler()
      return !offline.value
    } catch {
      // 重试链路本身出错不该冒泡到界面，状态已经由 reportSyncResult 更新
      return false
    } finally {
      retrying.value = false
    }
  }

  function onBrowserOnline(): void {
    browserOnline.value = true
    // 网卡刚回来：立刻试一次，用户不用再点「重试」
    void retry()
  }

  function onBrowserOffline(): void {
    browserOnline.value = false
  }

  /**
   * 启动：挂事件 + 起自动重试定时器
   *
   * 定时器只在"浏览器说在线、但服务端连不上"时干活（比如代理恢复、Supabase 抖动结束），
   * 真正的断网交给 `online` 事件，不需要轮询。
   */
  function init(): void {
    if (started) return
    started = true

    window.addEventListener('online', onBrowserOnline)
    window.addEventListener('offline', onBrowserOffline)

    timer = window.setInterval(() => {
      if (browserOnline.value && serverReachable.value === false) void retry()
    }, AUTO_RETRY_MS)
  }

  /** 应用退出 / 热更新时清理（Electron 里一般走不到，留着防止 HMR 叠加监听） */
  function dispose(): void {
    window.removeEventListener('online', onBrowserOnline)
    window.removeEventListener('offline', onBrowserOffline)
    if (timer !== undefined) window.clearInterval(timer)
    timer = undefined
    started = false
  }

  return {
    browserOnline,
    serverReachable,
    retrying,
    lastReachableAt,
    offline,
    reason,
    setRetryHandler,
    reportSyncResult,
    retry,
    init,
    dispose
  }
})
