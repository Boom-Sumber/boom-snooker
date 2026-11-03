<script setup lang="ts">
/**
 * 回收站（T7.2，超管专用）
 *
 * 只列**作者主动删除**的记录（`state = 0 and hidden_reason is null`）：
 *   · 停用账号的级联隐藏不在这里 —— 那类内容由「账户管理 → 恢复账号」统一还原，
 *     单独放出来会诱导误操作（docs/06 §5.2）
 *   · 审核驳回不算删除，作者还要改稿重提，不进这里
 *
 * 两个操作都是高危的：
 *   · **恢复**：服务端会校验作者是否仍停用，停用则拒绝（`OWNER_DISABLED`）
 *   · **物理删除**：不可逆。服务端先把整行快照写进 `admin_actions` 审计，
 *     再删评论 / 通知 / 行，并显式 bump `dataset_version`
 *
 * 删完的图片不在这里删 —— 服务端会返回"已无引用"的路径，留给孤儿图清理（T7.3）。
 */
import { computed, onMounted, ref, watch } from 'vue'
import { ElMessage, ElMessageBox } from 'element-plus'
import { BALL_LABELS, CATEGORY_LABELS } from '@renderer/navigation/menu'
import { useAuthStore, useDatasetStore, useNetworkStore } from '@renderer/stores'
import { imageUrl } from '@shared/media/url'
import LazyImage from '@renderer/components/LazyImage.vue'
import {
  listDeletedRecords,
  listOrphanImages,
  purgeOrphanImages,
  purgeRecord,
  restoreRecord,
  type DeletedRecord,
  type OrphanImage,
  type RecordType
} from '@shared/api/recycle'

const auth = useAuthStore()
const dataset = useDatasetStore()
/** 恢复 / 永久删除 / 清孤儿图都是写操作，离线全禁用（T6.1） */
const network = useNetworkStore()

const PAGE_SIZE = 20

const items = ref<DeletedRecord[]>([])
const total = ref(0)
const page = ref(1)
const typeFilter = ref<'all' | RecordType>('all')
const loading = ref(false)
/** 请求失败的原因（和"真的空"分开显示，否则权限/网络错误会被当成"回收站是空的"） */
const error = ref('')
/** 正在处理的那一条（按钮 loading + 防重复点击） */
const acting = ref<string | null>(null)

const canManage = computed(() => auth.isSuperadmin)

function pocketName(code: string | null): string {
  if (!code) return ''
  const row = dataset.dict.find((dict) => dict.kind === 'pocket' && dict.code === code)
  return row?.name_zh ?? code
}

function titleOf(item: DeletedRecord): string {
  if (item.rec_type === 'ball') {
    const color = BALL_LABELS[item.color_code ?? ''] ?? item.color_code ?? ''
    return [color, pocketName(item.pocket_code), item.title].filter(Boolean).join(' · ')
  }
  const category = CATEGORY_LABELS[item.category_code ?? ''] ?? item.category_code ?? ''
  return [category, item.title].filter(Boolean).join(' · ')
}

function timeText(raw: string): string {
  const date = new Date(raw)
  if (Number.isNaN(date.getTime())) return raw
  const pad = (n: number): string => String(n).padStart(2, '0')
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())} ${pad(date.getHours())}:${pad(date.getMinutes())}`
}

const firstImage = computed(
  () =>
    (item: DeletedRecord): string =>
      imageUrl(item.image_paths[0] ?? '')
)

async function load(): Promise<void> {
  if (!canManage.value) return
  loading.value = true
  error.value = ''
  const result = await listDeletedRecords({
    type: typeFilter.value === 'all' ? null : typeFilter.value,
    limit: PAGE_SIZE,
    offset: (page.value - 1) * PAGE_SIZE
  })
  loading.value = false

  if (!result.ok) {
    error.value = result.message
    items.value = []
    total.value = 0
    return
  }
  items.value = result.data.items
  total.value = result.data.total
}

function onFilterChange(): void {
  page.value = 1
  void load()
}

function onPageChange(next: number): void {
  page.value = next
  void load()
}

async function onRestore(item: DeletedRecord): Promise<void> {
  const confirmed = await ElMessageBox.confirm(
    `恢复后「${titleOf(item)}」会重新出现在列表里，作者也能继续编辑。`,
    '恢复这条记录？',
    { type: 'warning', confirmButtonText: '恢复', cancelButtonText: '取消' }
  ).catch(() => false)
  if (confirmed === false) return

  acting.value = item.id
  const result = await restoreRecord(item.rec_type, item.id)
  acting.value = null

  if (!result.ok) {
    ElMessage.error(result.message)
    return
  }
  ElMessage.success('已恢复')
  // 恢复会 bump 版本，顺手拉一次快照，页面上的列表数据立刻同步
  void dataset.sync(true)
  void load()
}

async function onPurge(item: DeletedRecord): Promise<void> {
  const confirmed = await ElMessageBox.confirm(
    `「${titleOf(item)}」将被**永久删除**，它的评论、通知和审计以外的数据都不会保留，且无法撤销。`,
    '彻底删除？',
    {
      type: 'error',
      confirmButtonText: '永久删除',
      cancelButtonText: '取消',
      confirmButtonClass: 'el-button--danger'
    }
  ).catch(() => false)
  if (confirmed === false) return

  acting.value = item.id
  const result = await purgeRecord(item.rec_type, item.id)
  acting.value = null

  if (!result.ok) {
    ElMessage.error(result.message)
    return
  }
  const orphans = result.data.length
  ElMessage.success(
    orphans > 0 ? `已永久删除；它独占的 ${orphans} 张图片已进入孤儿列表` : '已永久删除'
  )
  void dataset.sync(true)
  // 删掉最后一条时当前页可能空了，往前退一页
  if (items.value.length === 1 && page.value > 1) page.value -= 1
  void load()
  // 这条记录独占的图已经无引用，刷新孤儿列表让用户顺手清掉
  void loadOrphans()
}

/* ────────────────── 孤儿图（T7.3） ────────────────── */

const orphans = ref<OrphanImage[]>([])
const orphanTotal = ref(0)
const orphanBytes = ref(0)
const orphanLoading = ref(false)
const orphanError = ref('')
/** 勾选的路径；每次扫描后默认全选（列表里每一条都确实无引用） */
const orphanSelected = ref<string[]>([])
const orphanPurging = ref(false)

const selectedBytes = computed(() =>
  orphans.value
    .filter((item) => orphanSelected.value.includes(item.path))
    .reduce((sum, item) => sum + item.bytes, 0)
)

const allOrphansSelected = computed({
  get: () => orphans.value.length > 0 && orphanSelected.value.length === orphans.value.length,
  set: (checked: boolean) => {
    orphanSelected.value = checked ? orphans.value.map((item) => item.path) : []
  }
})

function sizeText(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
  return `${(bytes / 1024 / 1024).toFixed(2)} MB`
}

async function loadOrphans(): Promise<void> {
  if (!canManage.value) return
  orphanLoading.value = true
  orphanError.value = ''
  const result = await listOrphanImages({ limit: 200, offset: 0 })
  orphanLoading.value = false

  if (!result.ok) {
    orphanError.value = result.message
    orphans.value = []
    orphanTotal.value = 0
    orphanBytes.value = 0
    orphanSelected.value = []
    return
  }
  orphans.value = result.data.items
  orphanTotal.value = result.data.total
  orphanBytes.value = result.data.totalBytes
  orphanSelected.value = result.data.items.map((item) => item.path)
}

async function onPurgeOrphans(): Promise<void> {
  if (orphanSelected.value.length === 0) return

  const count = orphanSelected.value.length
  const confirmed = await ElMessageBox.confirm(
    `将删除 ${count} 张图片（${sizeText(selectedBytes.value)}）。` +
      '它们没有任何记录引用，删除后无法恢复。',
    '删除孤儿图片？',
    { type: 'error', confirmButtonText: '删除', cancelButtonText: '取消' }
  ).catch(() => false)
  if (confirmed === false) return

  orphanPurging.value = true
  const result = await purgeOrphanImages(orphanSelected.value)
  orphanPurging.value = false

  if (!result.ok) {
    ElMessage.error(result.message)
    return
  }
  ElMessage.success(`已删除 ${result.data.removed} 张图片`)
  void loadOrphans()
}

onMounted(() => {
  void load()
  // 已经登录超管时（比如从别的页面跳进来），`isSuperadmin` 一开始就是 true，
  // 下面的 watch 不会触发 —— 不在这里补一次，孤儿图区块会一直显示"桶是干净的"，
  // 必须手动点「重新扫描」才出结果（T11.3 实测踩到）
  if (auth.isSuperadmin) void loadOrphans()
})

// 首帧可能还没拿到 profile（`isSuperadmin` 先是 false），拿到之后要补一次请求，
// 否则刷新页面会停在"回收站是空的"
watch(
  () => auth.isSuperadmin,
  (allowed) => {
    if (!allowed) return
    void load()
    void loadOrphans()
  }
)
</script>

<template>
  <section class="recycle">
    <header class="head">
      <div>
        <h1 class="head__title">回收站</h1>
        <p class="head__sub">
          这里只有「作者主动删除」的记录。账号停用而隐藏的内容不在此列 ——
          请到「账户管理」恢复账号，内容会一起回来。
        </p>
      </div>
      <div class="head__actions">
        <el-radio-group v-model="typeFilter" :disabled="loading" @change="onFilterChange">
          <el-radio-button value="all">全部</el-radio-button>
          <el-radio-button value="ball">彩球</el-radio-button>
          <el-radio-button value="advanced">进阶</el-radio-button>
        </el-radio-group>
        <el-button :loading="loading" @click="load">刷新</el-button>
      </div>
    </header>

    <div v-if="!canManage" class="card empty">
      <p class="empty__title">没有权限</p>
      <p class="empty__text">回收站只对超级管理员开放。</p>
    </div>

    <template v-else>
      <p v-if="error" class="card empty">
        <span class="empty__title">加载失败</span>
        <span class="empty__text">{{ error }}</span>
        <el-button size="small" @click="load">重试</el-button>
      </p>

      <p v-else-if="!loading && items.length === 0" class="card empty">
        <span class="empty__title">回收站是空的</span>
        <span class="empty__text">被删除的记录会出现在这里，可以恢复或彻底删除。</span>
      </p>

      <ul v-else v-loading="loading" class="list">
        <li v-for="item in items" :key="`${item.rec_type}-${item.id}`" class="card row">
          <div class="row__thumb">
            <LazyImage v-if="firstImage(item)" :src="firstImage(item)" :alt="titleOf(item)" />
            <span v-else class="row__thumb-empty">无图</span>
          </div>

          <div class="row__main">
            <p class="row__title">
              <span class="row__badge">{{ item.rec_type === 'ball' ? '彩球' : '进阶' }}</span>
              {{ titleOf(item) }}
            </p>
            <p class="row__meta">
              <span>作者：{{ item.owner_nickname || '（未知）' }}</span>
              <span v-if="item.owner_deleted" class="row__warn">账号已停用</span>
              <span>删除时间：{{ timeText(item.deleted_at) }}</span>
              <span>{{ item.image_paths.length }} 张图</span>
            </p>
          </div>

          <div class="row__actions">
            <el-button
              :loading="acting === item.id"
              :disabled="acting !== null || network.offline"
              @click="onRestore(item)"
            >
              恢复
            </el-button>
            <el-button
              type="danger"
              plain
              :loading="acting === item.id"
              :disabled="acting !== null || network.offline"
              @click="onPurge(item)"
            >
              永久删除
            </el-button>
          </div>
        </li>
      </ul>

      <div v-if="total > PAGE_SIZE" class="pager">
        <el-pagination
          layout="prev, pager, next, total"
          :total="total"
          :page-size="PAGE_SIZE"
          :current-page="page"
          background
          @current-change="onPageChange"
        />
      </div>

      <!-- 孤儿图（T7.3）：桶里有、但没有任何记录引用的对象 -->
      <section class="card orphans">
        <header class="orphans__head">
          <div>
            <h2 class="orphans__title">孤儿图片</h2>
            <p class="orphans__sub">
              桶里有、但没有任何记录引用的对象（换图遗留、上传成功但没保存的残留）。
              删除不可撤销；被多条记录共享的图不会出现在这里。
            </p>
          </div>
          <div class="orphans__actions">
            <el-button :loading="orphanLoading" @click="loadOrphans">重新扫描</el-button>
            <el-button
              type="danger"
              plain
              :disabled="orphanSelected.length === 0 || network.offline"
              :loading="orphanPurging"
              @click="onPurgeOrphans"
            >
              删除选中（{{ orphanSelected.length }}）
            </el-button>
          </div>
        </header>

        <p v-if="orphanError" class="orphans__hint orphans__hint--error">{{ orphanError }}</p>

        <p v-else-if="!orphanLoading && orphans.length === 0" class="orphans__hint">
          没有孤儿图片，桶是干净的。
        </p>

        <template v-else>
          <div class="orphans__summary">
            <el-checkbox v-model="allOrphansSelected">全选</el-checkbox>
            <span>
              共 {{ orphanTotal }} 张 / {{ sizeText(orphanBytes) }}
              <template v-if="orphanTotal > orphans.length">
                （只列出前 {{ orphans.length }} 张）
              </template>
              <template v-if="orphanSelected.length > 0">
                · 已选 {{ sizeText(selectedBytes) }}
              </template>
            </span>
          </div>

          <el-checkbox-group v-model="orphanSelected" class="orphans__list">
            <el-checkbox
              v-for="item in orphans"
              :key="item.path"
              :value="item.path"
              class="orphans__item"
            >
              <span class="orphans__path">{{ item.path }}</span>
              <span class="orphans__size">{{ sizeText(item.bytes) }}</span>
            </el-checkbox>
          </el-checkbox-group>
        </template>
      </section>
    </template>
  </section>
</template>

<style scoped>
.recycle {
  display: flex;
  flex-direction: column;
  gap: 0.875rem;
  padding: clamp(16px, 2.2vw, 28px);
}

.head {
  display: flex;
  flex-wrap: wrap;
  gap: 1rem;
  align-items: flex-start;
  justify-content: space-between;
}

.head__title {
  margin: 0;
  font-size: clamp(1.25rem, 1.6vw, 1.5rem);
  font-weight: 500;
  color: var(--text-1);
}

.head__sub {
  max-width: 46rem;
  margin: 0.25rem 0 0;
  font-size: var(--font-size-sm);
  line-height: 1.6;
  color: var(--text-2);
}

.head__actions {
  display: flex;
  flex: none;
  gap: 0.5rem;
  align-items: center;
}

.list {
  display: flex;
  flex-direction: column;
  gap: 0.625rem;
  margin: 0;
  padding: 0;
  list-style: none;
}

.row {
  display: flex;
  gap: 0.875rem;
  align-items: center;
  padding: 0.75rem 1rem;
}

.row__thumb {
  display: grid;
  flex: none;
  place-items: center;
  width: 4.5rem;
  height: 4.5rem;
  padding: 0.25rem;
  overflow: hidden;
  border: 1px solid var(--border);
  border-radius: var(--radius-md);
}

.row__thumb-empty {
  font-size: 0.75rem;
  color: var(--text-3);
}

.row__main {
  flex: 1;
  min-width: 0;
}

.row__title {
  display: flex;
  gap: 0.5rem;
  align-items: center;
  margin: 0;
  font-size: 1rem;
  color: var(--text-1);
  overflow-wrap: anywhere;
}

.row__badge {
  flex: none;
  padding: 0 0.375rem;
  font-size: 0.75rem;
  color: var(--primary);
  background: color-mix(in srgb, var(--primary) 12%, transparent);
  border-radius: 999px;
}

.row__meta {
  display: flex;
  flex-wrap: wrap;
  gap: 0.25rem 1rem;
  margin: 0.375rem 0 0;
  font-size: var(--font-size-sm);
  color: var(--text-2);
}

.row__warn {
  color: var(--warning, #e6a23c);
}

.row__actions {
  display: flex;
  flex: none;
  gap: 0.5rem;
}

.empty {
  display: flex;
  flex-direction: column;
  gap: 0.375rem;
  align-items: center;
  padding: 2.5rem 1rem;
  text-align: center;
}

.empty__title {
  margin: 0;
  color: var(--text-1);
}

.empty__text {
  margin: 0;
  font-size: var(--font-size-sm);
  color: var(--text-3);
}

.pager {
  display: flex;
  justify-content: flex-end;
  padding-top: 0.25rem;
}

.orphans {
  display: flex;
  flex-direction: column;
  gap: 0.75rem;
  padding: 1rem 1.125rem 1.125rem;
}

.orphans__head {
  display: flex;
  flex-wrap: wrap;
  gap: 0.75rem;
  align-items: flex-start;
  justify-content: space-between;
}

.orphans__title {
  margin: 0;
  font-size: 1rem;
  font-weight: 500;
  color: var(--text-1);
}

.orphans__sub {
  max-width: 44rem;
  margin: 0.25rem 0 0;
  font-size: var(--font-size-sm);
  line-height: 1.6;
  color: var(--text-2);
}

.orphans__actions {
  display: flex;
  flex: none;
  gap: 0.5rem;
}

.orphans__hint {
  margin: 0;
  padding: 0.75rem 0;
  font-size: var(--font-size-sm);
  color: var(--text-3);
}

.orphans__hint--error {
  color: var(--danger, #f56c6c);
}

.orphans__summary {
  display: flex;
  gap: 0.75rem;
  align-items: center;
  font-size: var(--font-size-sm);
  color: var(--text-2);
}

.orphans__list {
  display: flex;
  flex-direction: column;
  gap: 0.25rem;
  max-height: 16rem;
  overflow-y: auto;
}

.orphans__item {
  display: flex;
  align-items: center;
  width: 100%;
  margin: 0;
  padding: 0.125rem 0;
}

.orphans__item :deep(.el-checkbox__label) {
  display: flex;
  flex: 1;
  gap: 0.75rem;
  align-items: center;
  justify-content: space-between;
  min-width: 0;
}

.orphans__path {
  overflow: hidden;
  font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
  font-size: 0.8125rem;
  color: var(--text-2);
  text-overflow: ellipsis;
  white-space: nowrap;
}

.orphans__size {
  flex: none;
  font-size: 0.8125rem;
  color: var(--text-3);
}
</style>
