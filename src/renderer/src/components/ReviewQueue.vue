<script setup lang="ts">
/**
 * 审核队列（T4.3 评论 + T4.5 记录）
 *
 * 两个页签，逻辑同构：
 *   · 评论 → `list_pending_comments` / `review_comment`
 *   · 记录 → `list_pending_records` / `review_record`
 *
 * 队列里**只放简要信息**（作者、时间、一行摘要、简短文字预览），
 * 真正的判断要看图 —— 所以每条都有「查看详情」：跳到详情页的审核预览模式，
 * 那里有完整的图与正文，看完直接通过/驳回（T4.6）。
 *
 * 范围由服务端决定（`can_review_owner`）：admin 只看自己邀请的人写的，超管只看直邀的。
 */
import { computed, onMounted, ref, watch } from 'vue'
import { useRouter } from 'vue-router'
import { ElMessage, ElMessageBox } from 'element-plus'
import AuthorTag from './AuthorTag.vue'
import { useDatasetStore, useNetworkStore } from '@renderer/stores'
import { listPendingComments, reviewComment, type PendingComment } from '@shared/api/comments'
import { listPendingRecords, reviewRecord, type PendingRecord } from '@shared/api/review'

const props = defineProps<{
  /** 顶部角标轮询到的数量，用来发现"开着的时候又来了新的" */
  commentCount?: number
  recordCount?: number
  /** 对话框每次打开时 +1，用来强制重拉 */
  refreshToken?: number
  /**
   * 只显示某一种队列（审核中心页面用）：
   * 传了就隐藏内部的页签栏，只渲染对应列表；不传保持原来的「评论 / 记录」双页签（通知弹窗用）
   */
  only?: 'comment' | 'record'
}>()

const emit = defineEmits<{
  /** 审核完一条：让顶部角标重新取数 */
  (event: 'changed'): void
  /** 点了「查看详情」：父组件要关掉对话框 */
  (event: 'leave'): void
}>()

const router = useRouter()
const dataset = useDatasetStore()
/** 离线时审核按钮全部置灰（T6.1） */
const network = useNetworkStore()

const tab = ref<'comment' | 'record'>(props.only ?? 'comment')

const comments = ref<PendingComment[]>([])
const records = ref<PendingRecord[]>([])
const loadingComments = ref(false)
const loadingRecords = ref(false)
const errorComments = ref('')
const errorRecords = ref('')
/** 正在处理的那条，禁用按钮防连点 */
const actingId = ref('')

const commentLabel = computed(() => `评论 ${props.commentCount ?? comments.value.length}`)
const recordLabel = computed(() => `记录 ${props.recordCount ?? records.value.length}`)

function formatTime(raw: string): string {
  const date = new Date(raw)
  if (Number.isNaN(date.getTime())) return raw
  const pad = (n: number): string => String(n).padStart(2, '0')
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())} ${pad(date.getHours())}:${pad(date.getMinutes())}`
}

/** 「黄球 · 右上袋 · 直线」/「翻袋系列 · 【满力】右半台翻中袋」 */
function commentTarget(item: PendingComment): string {
  if (item.target_type === 'ball') {
    const color = dataset.dictName('color', item.target_color)
    const pocket = dataset.dictName('pocket', item.target_pocket)
    return [color, pocket, item.target_method].filter(Boolean).join(' · ')
  }
  const category = dataset.dictName('category', item.target_category)
  return [category, item.target_title].filter(Boolean).join(' · ')
}

/** 记录的一行标题：彩球「颜色 · 袋口 · 力度 · 进袋方式」，进阶「系列 · 标题」 */
function recordTitle(item: PendingRecord): string {
  if (item.record_type === 'ball') {
    return [
      dataset.dictName('color', item.color_code),
      dataset.dictName('pocket', item.pocket_code),
      dataset.dictName('strength', item.strength_code),
      item.method
    ]
      .filter(Boolean)
      .join(' · ')
  }
  return [dataset.dictName('category', item.category_code), item.title].filter(Boolean).join(' · ')
}

/** 队列里只给一句摘要，完整正文和图片在详情页看 */
function recordSummary(item: PendingRecord): string {
  const preview = item.preview ?? {}
  const first =
    item.record_type === 'ball'
      ? preview.sight || preview.low_comp || preview.remark
      : preview.description || preview.content
  const text = (first ?? '').replace(/\s+/g, ' ').trim()
  return text.length > 60 ? `${text.slice(0, 60)}…` : text
}

/** 跳详情页的审核预览模式（记录） */
function openRecord(item: PendingRecord): void {
  if (item.record_type === 'ball') {
    void router.push(`/balls/${item.color_code}/${item.id}`)
  } else {
    void router.push(`/advanced/${item.category_code}/${item.id}`)
  }
  emit('leave')
}

/** 评论的「查看详情」= 跳到它挂着的记录（评论本身没有独立页面） */
function openComment(item: PendingComment): void {
  if (item.target_type === 'ball') {
    void router.push(`/balls/${item.target_color}/${item.target_id}`)
  } else {
    void router.push(`/advanced/${item.target_category}/${item.target_id}`)
  }
  emit('leave')
}

async function loadComments(): Promise<void> {
  loadingComments.value = true
  errorComments.value = ''

  const result = await listPendingComments({ limit: 50 })
  loadingComments.value = false

  if (!result.ok) {
    errorComments.value = result.message
    comments.value = []
    return
  }
  comments.value = result.data.items
}

async function loadRecords(): Promise<void> {
  loadingRecords.value = true
  errorRecords.value = ''

  const result = await listPendingRecords({ limit: 50 })
  loadingRecords.value = false

  if (!result.ok) {
    errorRecords.value = result.message
    records.value = []
    return
  }
  records.value = result.data.items
}

function loadAll(): void {
  void loadComments()
  void loadRecords()
}

/** 打开时优先停在"有东西要审"的那一页 */
function pickTab(): 'comment' | 'record' {
  // 单类型模式（审核中心页面复用）下类型是外部指定的，不能"猜"——
  // 之前这里无条件按计数选，导致传了 only="record" 的实例又被切回评论，列表永远是空的
  if (props.only) return props.only

  const c = props.commentCount ?? 0
  const r = props.recordCount ?? 0
  if (c === 0 && r > 0) return 'record'
  return 'comment'
}

async function approveComment(item: PendingComment): Promise<void> {
  if (actingId.value) return
  actingId.value = item.id

  const result = await reviewComment(item.id, 'visible')
  actingId.value = ''

  if (!result.ok) {
    ElMessage.error(result.message)
    return
  }
  ElMessage.success('已通过，评论已公开')
  emit('changed')
  await loadComments()
}

async function rejectComment(item: PendingComment): Promise<void> {
  if (actingId.value) return

  const answer = await ElMessageBox.prompt('驳回原因会通知给评论作者（可留空）', '驳回评论', {
    confirmButtonText: '驳回',
    cancelButtonText: '取消',
    inputType: 'textarea',
    inputPlaceholder: '比如：与打法无关 / 内容重复',
    inputValidator: (value: string) => (value && value.length > 200 ? '最多 200 字' : true)
  }).catch(() => null)
  if (!answer) return

  actingId.value = item.id
  const result = await reviewComment(item.id, 'rejected', answer.value ?? '')
  actingId.value = ''

  if (!result.ok) {
    ElMessage.error(result.message)
    return
  }
  ElMessage.success('已驳回')
  emit('changed')
  await loadComments()
}

async function approveRecord(item: PendingRecord): Promise<void> {
  if (actingId.value) return
  actingId.value = item.id

  const result = await reviewRecord(item.record_type, item.id, 'visible')
  actingId.value = ''

  if (!result.ok) {
    ElMessage.error(result.message)
    return
  }

  ElMessage.success('已通过，记录已发布')
  emit('changed')
  // 记录在快照里：通过会 bump 版本，必须同步一次，列表页才会出现这条
  await dataset.sync(true)
  await loadRecords()
}

async function rejectRecord(item: PendingRecord): Promise<void> {
  if (actingId.value) return

  const answer = await ElMessageBox.prompt('驳回原因会通知给作者', '驳回记录', {
    confirmButtonText: '驳回',
    cancelButtonText: '取消',
    inputType: 'textarea',
    inputPlaceholder: '比如：信息不完整 / 与已有条目重复',
    inputValidator: (value: string) => (value && value.length > 200 ? '最多 200 字' : true)
  }).catch(() => null)
  if (!answer) return

  actingId.value = item.id
  const result = await reviewRecord(item.record_type, item.id, 'rejected', answer.value ?? '')
  actingId.value = ''

  if (!result.ok) {
    ElMessage.error(result.message)
    return
  }
  ElMessage.success('已驳回')
  emit('changed')
  await loadRecords()
}

onMounted(() => {
  tab.value = pickTab()
  loadAll()
})

watch(
  () => props.refreshToken,
  () => {
    tab.value = pickTab()
    loadAll()
  }
)

/**
 * 顶部角标还在 60 秒轮询：数字和列表长度对不上 = 期间又来了新的（或被别人审掉了），
 * 补一次刷新，避免"角标显示 1、点进来是空的"。
 */
watch(
  () => [props.commentCount, props.recordCount],
  ([commentCount, recordCount]) => {
    if ((commentCount ?? 0) !== comments.value.length) void loadComments()
    if ((recordCount ?? 0) !== records.value.length) void loadRecords()
  }
)
</script>

<template>
  <el-tabs v-model="tab" :class="{ 'review--bare': !!only }">
    <!-- ── 评论 ── -->
    <el-tab-pane :label="commentLabel" name="comment">
      <!-- 离线说明（T6.1）：审核是写操作，必须联网；按钮同时置灰 -->
      <p v-if="network.offline" class="offline-write-hint review__offline">
        离线状态下无法审核，恢复网络后再处理待审内容
      </p>
      <p v-if="errorComments" class="review__error">
        {{ errorComments }}
        <el-button text type="primary" size="small" @click="loadComments">重试</el-button>
      </p>

      <div v-else-if="loadingComments" class="review__loading">
        <el-skeleton :rows="3" animated />
      </div>

      <el-empty v-else-if="comments.length === 0" description="没有待审评论" :image-size="72" />

      <ul v-else class="review__list">
        <li v-for="item in comments" :key="item.id" class="pending">
          <header class="pending__head">
            <AuthorTag :name="item.nickname" :deleted="item.author_deleted" />
            <time class="pending__time">{{ formatTime(item.created_at) }}</time>
          </header>

          <p class="pending__text">{{ item.content }}</p>
          <p class="pending__target-line">挂在：{{ commentTarget(item) }}</p>

          <footer class="pending__actions">
            <el-button size="small" text type="primary" @click="openComment(item)">
              查看详情
            </el-button>
            <el-button
              size="small"
              :disabled="actingId === item.id || network.offline"
              :loading="actingId === item.id"
              @click="rejectComment(item)"
            >
              驳回
            </el-button>
            <el-button
              size="small"
              type="primary"
              :disabled="actingId === item.id || network.offline"
              :loading="actingId === item.id"
              @click="approveComment(item)"
            >
              通过
            </el-button>
          </footer>
        </li>
      </ul>
    </el-tab-pane>

    <!-- ── 记录 ── -->
    <el-tab-pane :label="recordLabel" name="record">
      <p v-if="network.offline" class="offline-write-hint review__offline">
        离线状态下无法审核，恢复网络后再处理待审内容
      </p>
      <p v-if="errorRecords" class="review__error">
        {{ errorRecords }}
        <el-button text type="primary" size="small" @click="loadRecords">重试</el-button>
      </p>

      <div v-else-if="loadingRecords" class="review__loading">
        <el-skeleton :rows="3" animated />
      </div>

      <el-empty v-else-if="records.length === 0" description="没有待审记录" :image-size="72" />

      <ul v-else class="review__list">
        <li v-for="item in records" :key="item.id" class="pending">
          <header class="pending__head">
            <AuthorTag :name="item.nickname" :deleted="item.author_deleted" />
            <time class="pending__time">{{ formatTime(item.created_at) }}</time>
            <span class="pending__badge">{{ item.record_type === 'ball' ? '彩球' : '进阶' }}</span>
          </header>

          <p class="pending__title">{{ recordTitle(item) }}</p>
          <p v-if="recordSummary(item)" class="pending__summary">{{ recordSummary(item) }}</p>

          <footer class="pending__actions">
            <el-button size="small" text type="primary" @click="openRecord(item)">
              查看详情
            </el-button>
            <el-button
              size="small"
              :disabled="actingId === item.id || network.offline"
              :loading="actingId === item.id"
              @click="rejectRecord(item)"
            >
              驳回
            </el-button>
            <el-button
              size="small"
              type="primary"
              :disabled="actingId === item.id || network.offline"
              :loading="actingId === item.id"
              @click="approveRecord(item)"
            >
              通过
            </el-button>
          </footer>
        </li>
      </ul>
    </el-tab-pane>
  </el-tabs>
</template>

<style scoped>
/* 审核中心页面里由外层页签控制类型，这里不需要再显示一层页签 */
.review--bare :deep(.el-tabs__header) {
  display: none;
}

.review__offline {
  margin: 0 0 0.5rem;
  font-size: var(--font-size-sm);
}

.review__error {
  display: flex;
  gap: 0.5rem;
  align-items: center;
  margin: 0;
  font-size: var(--font-size-sm);
  color: var(--text-2);
}

.review__list {
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

.pending__head {
  display: flex;
  flex-wrap: wrap;
  gap: 0.5rem;
  align-items: center;
  font-size: var(--font-size-sm);
  color: var(--text-2);
}

.pending__time {
  color: var(--text-3);
}

/* 「彩球 / 进阶」类型标记 */
.pending__badge {
  padding: 0 0.375rem;
  font-size: var(--font-size-sm);
  line-height: 1.6;
  color: var(--text-2);
  background: var(--surface);
  border: 1px solid var(--border);
  border-radius: 999px;
}

.pending__text {
  margin: 0;
  font-size: 0.9375rem;
  line-height: 1.7;
  color: var(--text-1);
  white-space: pre-wrap;
  overflow-wrap: anywhere;
}

.pending__title {
  margin: 0;
  font-size: 0.9375rem;
  font-weight: 500;
  line-height: 1.6;
  color: var(--text-1);
  overflow-wrap: anywhere;
}

.pending__summary {
  margin: 0;
  font-size: var(--font-size-sm);
  line-height: 1.6;
  color: var(--text-2);
  overflow-wrap: anywhere;
}

.pending__target-line {
  margin: 0;
  font-size: var(--font-size-sm);
  color: var(--text-3);
}

.pending__actions {
  display: flex;
  gap: 0.5rem;
  align-items: center;
  justify-content: flex-end;
}
</style>
