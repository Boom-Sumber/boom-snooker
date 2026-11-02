<script setup lang="ts">
/**
 * 审核对话框（T4.3 评论 + T4.5 记录）
 *
 * 入口是顶部铃铛：角标 = 待审评论数 + 待审记录数，60 秒轮询一次（见 TopBar）。
 * 两个页签各自是一个队列，逻辑同构：
 *   · 评论 → `list_pending_comments` / `review_comment`
 *   · 记录 → `list_pending_records` / `review_record`
 *
 * 范围都由服务端决定（`can_review_owner`）：admin 只看自己邀请的人写的，超管只看直邀的。
 * 前端不做二次过滤 —— 过滤只是"少犯错"，不是安全边界。
 *
 * 两类内容的差别（很容易踩）：
 *   · 评论**不进快照**，审完不用同步，作者下次打开详情页就看到结果
 *   · 记录**在快照里**，通过会 bump `dataset_version`，必须 `dataset.sync(true)`，
 *     否则列表页还是旧数据
 *   · 待审记录不在快照里，详情页打不开，所以队列直接带回文字预览（`preview`）
 */
import { computed, ref, watch } from 'vue'
import { useRouter } from 'vue-router'
import { ElMessage, ElMessageBox } from 'element-plus'
import AuthorTag from './AuthorTag.vue'
import { useDatasetStore } from '@renderer/stores'
import { listPendingComments, reviewComment, type PendingComment } from '@shared/api/comments'
import { listPendingRecords, reviewRecord, type PendingRecord } from '@shared/api/review'

const props = defineProps<{
  visible: boolean
  /** 顶部角标轮询到的数量，用来发现"开着的时候又来了新的" */
  commentCount?: number
  recordCount?: number
}>()

const emit = defineEmits<{
  (event: 'update:visible', value: boolean): void
  /** 处理完一条：让顶部角标重新取数 */
  (event: 'changed'): void
}>()

const router = useRouter()
const dataset = useDatasetStore()

const dialogVisible = computed({
  get: () => props.visible,
  set: (value: boolean) => emit('update:visible', value)
})

const tab = ref<'comment' | 'record'>('comment')

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

/** 记录的标题行：彩球是「颜色 · 袋口 · 力度 · 进袋方式」，进阶是「系列 · 标题」 */
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

/** 记录的文字预览：只取有内容的字段，空的整行不显示 */
function recordPreview(item: PendingRecord): { label: string; text: string }[] {
  const preview = item.preview ?? {}
  const pairs: [string, string | null | undefined][] =
    item.record_type === 'ball'
      ? [
          ['瞄准', preview.sight],
          ['低杆走位', preview.low_comp],
          ['高杆走位', preview.high_comp],
          ['补充说明', preview.remark]
        ]
      : [
          ['描述', preview.description],
          ['注解', preview.content]
        ]

  return pairs
    .filter(([, text]) => Boolean(text && text.trim()))
    .map(([label, text]) => ({ label, text: text as string }))
}

/** 点评论的目标胶囊：关掉对话框，跳到那条记录的详情页 */
function openCommentTarget(item: PendingComment): void {
  dialogVisible.value = false
  if (item.target_type === 'ball') {
    void router.push(`/balls/${item.target_color}/${item.target_id}`)
  } else {
    void router.push(`/advanced/${item.target_category}/${item.target_id}`)
  }
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

  const answer = await ElMessageBox.prompt('驳回原因会显示给评论作者（可留空）', '驳回评论', {
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

  const answer = await ElMessageBox.prompt(
    '驳回原因（作者暂时看不到，先记在审核记录里）',
    '驳回记录',
    {
      confirmButtonText: '驳回',
      cancelButtonText: '取消',
      inputType: 'textarea',
      inputPlaceholder: '比如：信息不完整 / 与已有条目重复',
      inputValidator: (value: string) => (value && value.length > 200 ? '最多 200 字' : true)
    }
  ).catch(() => null)
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

// 每次打开都重新拉：队列变化快，缓存没意义
watch(
  () => props.visible,
  (visible) => {
    if (!visible) return
    tab.value = pickTab()
    loadAll()
  }
)

/**
 * 对话框开着的时候，顶部角标还在 60 秒轮询。
 * 数字和列表长度对不上 = 期间又来了新的（或者被别人审掉了），补一次刷新，
 * 否则会出现"角标显示 1、点进来是空的"。
 * 自己审核完也会让数字变，但那时列表已经同步，不会重复请求。
 */
watch(
  () => [props.commentCount, props.recordCount],
  ([commentCount, recordCount]) => {
    if (!props.visible) return
    if ((commentCount ?? 0) !== comments.value.length) void loadComments()
    if ((recordCount ?? 0) !== records.value.length) void loadRecords()
  }
)
</script>

<template>
  <el-dialog v-model="dialogVisible" title="待审内容" width="46rem" top="8vh" append-to-body>
    <el-tabs v-model="tab">
      <!-- ── 评论 ── -->
      <el-tab-pane :label="commentLabel" name="comment">
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
              <button
                class="pending__target"
                type="button"
                title="打开这条记录的详情"
                @click="openCommentTarget(item)"
              >
                {{ commentTarget(item) }}
              </button>
            </header>

            <p class="pending__text">{{ item.content }}</p>

            <footer class="pending__actions">
              <el-button
                size="small"
                :disabled="actingId === item.id"
                :loading="actingId === item.id"
                @click="rejectComment(item)"
              >
                驳回
              </el-button>
              <el-button
                size="small"
                type="primary"
                :disabled="actingId === item.id"
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
              <span class="pending__badge">{{
                item.record_type === 'ball' ? '彩球' : '进阶'
              }}</span>
            </header>

            <p class="pending__title">{{ recordTitle(item) }}</p>

            <dl class="pending__preview">
              <div v-for="line in recordPreview(item)" :key="line.label" class="pending__line">
                <dt>{{ line.label }}</dt>
                <dd>{{ line.text }}</dd>
              </div>
            </dl>

            <footer class="pending__actions">
              <el-button
                size="small"
                :disabled="actingId === item.id"
                :loading="actingId === item.id"
                @click="rejectRecord(item)"
              >
                驳回
              </el-button>
              <el-button
                size="small"
                type="primary"
                :disabled="actingId === item.id"
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

    <template #footer>
      <span class="review__hint"
        >通过后立即公开；评论的驳回原因只有作者看得到，记录驳回原因记在审核日志里</span
      >
    </template>
  </el-dialog>
</template>

<style scoped>
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

/* 目标记录做成可点的胶囊：审核要看上下文，直接跳过去 */
.pending__target {
  padding: 0 0.5rem;
  font-size: var(--font-size-sm);
  line-height: 1.6;
  color: var(--primary);
  cursor: pointer;
  background: color-mix(in srgb, var(--primary) 10%, transparent);
  border: 0;
  border-radius: 999px;
}

.pending__target:hover {
  background: color-mix(in srgb, var(--primary) 18%, transparent);
}

/* 「彩球 / 进阶」类型标记：不可点，纯标签 */
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

.pending__preview {
  display: flex;
  flex-direction: column;
  gap: 0.25rem;
  margin: 0;
}

.pending__line {
  display: grid;
  grid-template-columns: 4.5rem minmax(0, 1fr);
  gap: 0.5rem;
  font-size: var(--font-size-sm);
  line-height: 1.7;
}

.pending__line dt {
  color: var(--text-3);
}

.pending__line dd {
  margin: 0;
  color: var(--text-2);
  white-space: pre-wrap;
  overflow-wrap: anywhere;
}

.pending__actions {
  display: flex;
  gap: 0.5rem;
  justify-content: flex-end;
}

.review__hint {
  font-size: var(--font-size-sm);
  color: var(--text-3);
}
</style>
