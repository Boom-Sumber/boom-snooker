<script setup lang="ts">
/**
 * 已驳回队列（T8.4，D34）
 *
 * 列的是 `state=1 and review_status='rejected'` 的记录 —— 作者既不重提也不删除，
 * 卡在中间状态。管理方有两个动作：
 *   · **再次提醒**：给作者发一条通知（同一条 24h 内只能一次，服务端拦）
 *   · **永久删除**：只有超管能点，删前会提示不可撤销
 *
 * 驳回超过 72 小时的条目，卡片边框换成警示色并显示「已驳回 N 天」——
 * 这是唯一"视觉催办"手段，不排序、不加角标，避免把正常队列搞乱。
 *
 * 不放通知页：通知页是「发给我的」，这里是「我能管的」（按 can_review_owner 过滤）。
 */
import { computed, onMounted, ref, watch } from 'vue'
import { ElMessage, ElMessageBox } from 'element-plus'
import LazyImage from './LazyImage.vue'
import AuthorTag from './AuthorTag.vue'
import { BALL_LABELS, CATEGORY_LABELS } from '@renderer/navigation/menu'
import { useAuthStore, useDatasetStore } from '@renderer/stores'
import { imageUrl } from '@shared/media/url'
import { purgeRecord } from '@shared/api/recycle'
import { listRejectedRecords, remindRejected, type RejectedRecord } from '@shared/api/review'

const props = defineProps<{
  /** 页面每次刷新时 +1，用来强制重拉 */
  refreshToken?: number
}>()

const emit = defineEmits<{ (event: 'changed'): void }>()

const auth = useAuthStore()
const dataset = useDatasetStore()

/** 超过这个小时数就视觉催办 */
const STALE_HOURS = 72

const items = ref<RejectedRecord[]>([])
const total = ref(0)
const loading = ref(false)
const error = ref('')
/** 正在处理的那条，禁用按钮防连点 */
const actingId = ref('')

function pocketName(code: string | null): string {
  if (!code) return ''
  const row = dataset.dict.find((dict) => dict.kind === 'pocket' && dict.code === code)
  return row?.name_zh ?? code
}

function titleOf(item: RejectedRecord): string {
  if (item.rec_type === 'ball') {
    const color = BALL_LABELS[item.color_code ?? ''] ?? item.color_code ?? ''
    return [color, pocketName(item.pocket_code), item.title].filter(Boolean).join(' · ')
  }
  const category = CATEGORY_LABELS[item.category_code ?? ''] ?? item.category_code ?? ''
  return [category, item.title].filter(Boolean).join(' · ')
}

function formatTime(raw: string | null): string {
  if (!raw) return '—'
  const date = new Date(raw)
  if (Number.isNaN(date.getTime())) return raw
  const pad = (n: number): string => String(n).padStart(2, '0')
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())} ${pad(date.getHours())}:${pad(date.getMinutes())}`
}

/** 驳回至今多少小时（没有 reviewed_at 时按 0 算，不催办） */
function staleHours(item: RejectedRecord): number {
  if (!item.reviewed_at) return 0
  const at = new Date(item.reviewed_at).getTime()
  if (Number.isNaN(at)) return 0
  return (Date.now() - at) / 36e5
}

function isStale(item: RejectedRecord): boolean {
  return staleHours(item) >= STALE_HOURS
}

function staleText(item: RejectedRecord): string {
  const hours = staleHours(item)
  if (hours < STALE_HOURS) return ''
  const days = Math.floor(hours / 24)
  return days >= 1 ? `已驳回 ${days} 天` : `已驳回 ${Math.floor(hours)} 小时`
}

const firstImage = computed(
  () =>
    (item: RejectedRecord): string =>
      imageUrl(item.image_paths[0] ?? '')
)

async function load(): Promise<void> {
  loading.value = true
  error.value = ''
  const result = await listRejectedRecords({ limit: 50, offset: 0 })
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

async function onRemind(item: RejectedRecord): Promise<void> {
  actingId.value = item.id
  const result = await remindRejected(item.rec_type, item.id)
  actingId.value = ''

  if (!result.ok) {
    ElMessage.warning(result.message)
    return
  }
  ElMessage.success('已提醒作者')
  emit('changed')
}

async function onPurge(item: RejectedRecord): Promise<void> {
  const confirmed = await ElMessageBox.confirm(
    `「${titleOf(item)}」将被**永久删除**，作者那边的「我的投稿」里也会消失，且无法撤销。`,
    '永久删除这条投稿？',
    {
      type: 'error',
      confirmButtonText: '永久删除',
      cancelButtonText: '取消'
    }
  ).catch(() => false)
  if (confirmed === false) return

  actingId.value = item.id
  const result = await purgeRecord(item.rec_type, item.id)
  actingId.value = ''

  if (!result.ok) {
    ElMessage.error(result.message)
    return
  }
  const orphans = result.data.length
  ElMessage.success(
    orphans > 0 ? `已永久删除；它独占的 ${orphans} 张图片已进入孤儿列表` : '已永久删除'
  )
  void dataset.sync(true)
  emit('changed')
  void load()
}

onMounted(() => {
  void load()
})

// 页面刷新 / 换号后重拉
watch(
  () => props.refreshToken,
  () => {
    void load()
  }
)
</script>

<template>
  <div class="rejected">
    <p v-if="error" class="rejected__error">
      {{ error }}
      <el-button text type="primary" size="small" @click="load">重试</el-button>
    </p>

    <div v-else-if="loading" class="rejected__loading">
      <el-skeleton :rows="3" animated />
    </div>

    <el-empty v-else-if="items.length === 0" description="没有已驳回的记录" :image-size="72" />

    <ul v-else class="rejected__list">
      <li
        v-for="item in items"
        :key="`${item.rec_type}-${item.id}`"
        class="pending"
        :class="{ 'pending--stale': isStale(item) }"
      >
        <div class="pending__body">
          <div class="pending__thumb">
            <LazyImage v-if="firstImage(item)" :src="firstImage(item)" :alt="titleOf(item)" />
            <span v-else class="pending__thumb-empty">无图</span>
          </div>

          <div class="pending__main">
            <header class="pending__head">
              <span class="pending__badge">{{ item.rec_type === 'ball' ? '彩球' : '进阶' }}</span>
              <strong class="pending__title">{{ titleOf(item) }}</strong>
              <el-tag v-if="isStale(item)" type="warning" size="small" effect="plain">
                {{ staleText(item) }}
              </el-tag>
            </header>

            <p class="pending__meta">
              <span
                >作者：<AuthorTag :name="item.owner_nickname" :deleted="item.owner_deleted"
              /></span>
              <span>驳回：{{ formatTime(item.reviewed_at) }}</span>
              <span v-if="item.reviewer_nickname"> 审核人：{{ item.reviewer_nickname }} </span>
            </p>

            <p v-if="item.review_note" class="pending__note">驳回原因：{{ item.review_note }}</p>
          </div>
        </div>

        <footer class="pending__actions">
          <el-button
            size="small"
            :disabled="actingId === item.id"
            :loading="actingId === item.id"
            @click="onRemind(item)"
          >
            再次提醒
          </el-button>
          <!-- 物理删除只有超管能做（D34） -->
          <el-button
            v-if="auth.isSuperadmin"
            size="small"
            type="danger"
            plain
            :disabled="actingId === item.id"
            :loading="actingId === item.id"
            @click="onPurge(item)"
          >
            永久删除
          </el-button>
        </footer>
      </li>
    </ul>

    <p v-if="total > items.length" class="rejected__more">
      共 {{ total }} 条，当前只显示前 {{ items.length }} 条
    </p>
  </div>
</template>

<style scoped>
.rejected {
  display: flex;
  flex-direction: column;
  gap: 0.75rem;
}

.rejected__error {
  display: flex;
  gap: 0.5rem;
  align-items: center;
  margin: 0;
  font-size: var(--font-size-sm);
  color: var(--text-2);
}

.rejected__list {
  display: flex;
  flex-direction: column;
  gap: 0.75rem;
  max-height: 58vh;
  padding: 0;
  margin: 0;
  overflow-y: auto;
  list-style: none;
}

.pending {
  display: flex;
  flex-direction: column;
  gap: 0.5rem;
  padding: 0.75rem 0.875rem;
  background: var(--surface-2);
  border: 1px solid var(--border);
  border-radius: var(--radius-md);
}

/* 超过 72 小时：整卡描边换成警示色，是唯一的催办手段 */
.pending--stale {
  border-color: var(--warning, #e6a23c);
  box-shadow: inset 3px 0 0 var(--warning, #e6a23c);
}

.pending__body {
  display: flex;
  gap: 0.75rem;
  align-items: flex-start;
}

.pending__thumb {
  display: grid;
  flex: none;
  place-items: center;
  width: 4rem;
  height: 4rem;
  padding: 0.25rem;
  overflow: hidden;
  border: 1px solid var(--border);
  border-radius: var(--radius-md);
}

.pending__thumb-empty {
  font-size: 0.75rem;
  color: var(--text-3);
}

.pending__main {
  flex: 1;
  min-width: 0;
}

.pending__head {
  display: flex;
  flex-wrap: wrap;
  gap: 0.5rem;
  align-items: center;
}

.pending__badge {
  padding: 0 0.375rem;
  font-size: var(--font-size-sm);
  line-height: 1.6;
  color: var(--text-2);
  background: var(--surface);
  border: 1px solid var(--border);
  border-radius: 999px;
}

.pending__title {
  font-size: 0.9375rem;
  font-weight: 500;
  color: var(--text-1);
  overflow-wrap: anywhere;
}

.pending__meta {
  display: flex;
  flex-wrap: wrap;
  gap: 0.25rem 1rem;
  margin: 0.375rem 0 0;
  font-size: var(--font-size-sm);
  color: var(--text-2);
}

.pending__note {
  margin: 0.375rem 0 0;
  font-size: var(--font-size-sm);
  line-height: 1.6;
  color: var(--text-2);
  overflow-wrap: anywhere;
}

.pending__actions {
  display: flex;
  gap: 0.5rem;
  justify-content: flex-end;
}

.rejected__more {
  margin: 0;
  font-size: var(--font-size-sm);
  color: var(--text-3);
  text-align: right;
}
</style>
