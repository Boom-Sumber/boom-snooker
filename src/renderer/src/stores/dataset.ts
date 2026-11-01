/**
 * 数据 store（全量快照 + 派生查询）
 *
 * 读路径：**永远先读内存/本地缓存**，网络只负责"把缓存变新"。
 * 启动时 `peekLocalDataset()` 同步取到上次的快照，首帧就有内容；
 * 然后后台比对版本，有新版本才替换（stale-while-revalidate）。
 *
 * 派生查询（按颜色分组、按分类分组、字典名）都放 getter 里做一次，
 * 组件里不要再自己 filter 一遍 —— 122 条数据虽然不大，但每次渲染都过滤
 * 会在列表页滚动时堆成明显的开销。
 */
import { defineStore } from 'pinia'
import { computed, ref } from 'vue'
import {
  peekLocalDataset,
  readLocalDataset,
  syncDataset,
  type DatasetSnapshot,
  type SyncProgress,
  type SyncStatus
} from '@shared/sync/snapshot'
import type { Tables } from '@shared/types/db'

/**
 * 快照行 + `author_deleted`（D30）
 *
 * 服务端 `get_dataset_snapshot()` 会给每行多塞一个 `author_deleted`，
 * 但 `shared/types/db.ts` 是表结构的快照类型，不含这个计算字段，所以在这里补。
 * 旧版本地缓存里没有这个字段 —— 读取时按 `undefined`（= 未停用）处理即可。
 */
export type Ball = Tables<'balls'> & { author_deleted?: boolean }
export type Advanced = Tables<'advanced'> & { author_deleted?: boolean }
export type DictRow = Tables<'display_dict'>

export type SyncState = 'idle' | SyncStatus

export const useDatasetStore = defineStore('dataset', () => {
  /** 首帧直接拿内存里的快照，没有则为 null（随后 init 会去同步） */
  const snapshot = ref<DatasetSnapshot | null>(peekLocalDataset())
  const syncState = ref<SyncState>('idle')
  const syncing = ref(false)
  const progress = ref<SyncProgress | null>(null)
  const lastError = ref('')

  const version = computed(() => snapshot.value?.version ?? null)
  const balls = computed<Ball[]>(() => snapshot.value?.balls ?? [])
  const advanced = computed<Advanced[]>(() => snapshot.value?.advanced ?? [])
  const dict = computed<DictRow[]>(() => snapshot.value?.dict ?? [])
  const lastSyncAt = computed(() => snapshot.value?.savedAt ?? null)

  /** 有数据就算 ready；离线且从没同步过时为 false，页面要显示空状态 */
  const isReady = computed(() => balls.value.length > 0 || advanced.value.length > 0)

  /** kind → code → 中文名 */
  const dictMap = computed(() => {
    const map = new Map<string, Map<string, string>>()
    for (const row of dict.value) {
      let byCode = map.get(row.kind)
      if (!byCode) {
        byCode = new Map()
        map.set(row.kind, byCode)
      }
      byCode.set(row.code, row.name_zh)
    }
    return map
  })

  /** 颜色 code → 该颜色的所有打法（列表页按颜色 tab 切） */
  const ballsByColor = computed(() => {
    const map = new Map<string, Ball[]>()
    for (const ball of balls.value) {
      const list = map.get(ball.color_code)
      if (list) {
        list.push(ball)
      } else {
        map.set(ball.color_code, [ball])
      }
    }
    return map
  })

  /** 分类 code → 进阶条目 */
  const advancedByCategory = computed(() => {
    const map = new Map<string, Advanced[]>()
    for (const item of advanced.value) {
      const list = map.get(item.category_code)
      if (list) {
        list.push(item)
      } else {
        map.set(item.category_code, [item])
      }
    }
    return map
  })

  /** 字典查名；查不到回落 code 本身（宁可显示 `top_left` 也不显示空白） */
  function dictName(kind: string, code: string | null | undefined): string {
    if (!code) return ''
    return dictMap.value.get(kind)?.get(code) ?? code
  }

  function findBall(id: string): Ball | null {
    return balls.value.find((item) => item.id === id) ?? null
  }

  function findAdvanced(id: string): Advanced | null {
    return advanced.value.find((item) => item.id === id) ?? null
  }

  /**
   * 同步并刷新 store
   *
   * `syncDataset` 永不抛错，返回状态；只有真的 `updated` 才重新读缓存。
   */
  async function sync(force = false): Promise<SyncState> {
    if (syncing.value) return syncState.value
    syncing.value = true
    lastError.value = ''

    try {
      const result = await syncDataset({
        force,
        onProgress: (next) => {
          progress.value = next
        }
      })
      syncState.value = result.status
      if (result.message) lastError.value = result.message

      // 两种情况都要把缓存读进 store：
      //   ① updated —— 缓存刚被原子替换，内存里还是旧对象
      //   ② snapshot 为空 —— 首次进入时 `peekLocalDataset()` 只能读内存（新页面内存是空的），
      //      磁盘上有缓存但版本又正好一致，此时 status 是 'up-to-date'，不读就永远空白
      if (result.status === 'updated' || snapshot.value === null) {
        const next = await readLocalDataset()
        if (next) snapshot.value = next
      }
      return result.status
    } finally {
      syncing.value = false
      progress.value = null
    }
  }

  /**
   * 启动入口
   *
   * 先尝试读**磁盘**缓存（`peekLocalDataset()` 只读内存，新页面里是空的），
   * 读到就立刻可用，再后台静默比对版本；完全没有缓存才等首次同步。
   */
  async function init(): Promise<void> {
    if (!snapshot.value) {
      const cached = await readLocalDataset()
      if (cached) snapshot.value = cached
    }

    if (snapshot.value) {
      void sync()
      return
    }
    await sync()
  }

  return {
    snapshot,
    syncState,
    syncing,
    progress,
    lastError,
    version,
    balls,
    advanced,
    dict,
    lastSyncAt,
    isReady,
    dictMap,
    ballsByColor,
    advancedByCategory,
    dictName,
    findBall,
    findAdvanced,
    sync,
    init
  }
})
