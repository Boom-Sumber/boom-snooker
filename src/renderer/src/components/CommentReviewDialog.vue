<script setup lang="ts">
/**
 * 待审评论对话框（T4.3）
 *
 * 入口是顶部铃铛（角标显示待审数，60 秒轮询一次）。
 *
 * 审核范围由服务端决定（`can_review_owner`）：admin 只看到自己邀请的人写的，
 * 超管只看直邀的。前端不做二次过滤 —— 过滤只是"少犯错"，不是安全边界。
 *
 * 通过 = `review_comment(id, 'visible')`；驳回可以填原因，原因会显示给作者
 * （`list_comments` 只把 `review_note` 回给评论作者本人，别人看不到）。
 *
 * 审核完不 bump `dataset_version`（铁律 6）：评论不在快照里，
 * 作者下次打开详情页就能看到结果。
 */
import { computed, ref, watch } from 'vue'
import { useRouter } from 'vue-router'
import { ElMessage, ElMessageBox } from 'element-plus'
import AuthorTag from './AuthorTag.vue'
import { useDatasetStore } from '@renderer/stores'
import { listPendingComments, reviewComment, type PendingComment } from '@shared/api/comments'

const props = defineProps<{
  visible: boolean
  /** 顶部角标当前显示的待审数（父组件轮询出来的），用来发现"开着的时候又来了新的" */
  pendingCount?: number
}>()

const emit = defineEmits<{
  (event: 'update:visible', value: boolean): void
  /** 处理完一条：让顶部角标重新取数 */
  (event: 'changed'): void
}>()

const router = useRouter()
const dataset = useDatasetStore()

const items = ref<PendingComment[]>([])
const loading = ref(false)
const errorText = ref('')
/** 正在处理的那条 id，用来禁用按钮，避免连点两次 */
const actingId = ref('')

const dialogVisible = computed({
  get: () => props.visible,
  set: (value: boolean) => emit('update:visible', value)
})

/** 「黄球 · 右上袋 · 直线」/「翻袋系列 · 【满力】右半台翻中袋」 */
function targetLabel(item: PendingComment): string {
  if (item.target_type === 'ball') {
    const color = dataset.dictName('color', item.target_color)
    const pocket = dataset.dictName('pocket', item.target_pocket)
    return [color, pocket, item.target_method].filter(Boolean).join(' · ')
  }
  const category = dataset.dictName('category', item.target_category)
  return [category, item.target_title].filter(Boolean).join(' · ')
}

function formatTime(raw: string): string {
  const date = new Date(raw)
  if (Number.isNaN(date.getTime())) return raw
  const pad = (n: number): string => String(n).padStart(2, '0')
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())} ${pad(date.getHours())}:${pad(date.getMinutes())}`
}

/** 点目标标签：关掉对话框，跳到那条记录的详情页（作者写的评论要看上下文） */
function openTarget(item: PendingComment): void {
  dialogVisible.value = false
  if (item.target_type === 'ball') {
    void router.push(`/balls/${item.target_color}/${item.target_id}`)
  } else {
    void router.push(`/advanced/${item.target_category}/${item.target_id}`)
  }
}

async function load(): Promise<void> {
  loading.value = true
  errorText.value = ''

  const result = await listPendingComments({ limit: 50 })
  loading.value = false

  if (!result.ok) {
    errorText.value = result.message
    items.value = []
    return
  }
  items.value = result.data.items
}

async function approve(item: PendingComment): Promise<void> {
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
  await load()
}

async function reject(item: PendingComment): Promise<void> {
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
  await load()
}

// 每次打开都重新拉：待审队列变化快，缓存没意义
watch(
  () => props.visible,
  (visible) => {
    if (visible) void load()
  }
)

/**
 * 对话框开着的时候，顶部角标还在 60 秒轮询。
 * 数字和列表长度对不上 = 期间又来了新的（或者被别人审掉了），补一次刷新，
 * 否则会出现"角标显示 1、点进来是空的"。
 * 自己审核完也会让数字变，但那时 `items.length` 已经同步，不会重复请求。
 */
watch(
  () => props.pendingCount,
  (count) => {
    if (props.visible && count !== undefined && count !== items.value.length) void load()
  }
)
</script>

<template>
  <el-dialog v-model="dialogVisible" title="待审评论" width="46rem" top="8vh" append-to-body>
    <p v-if="errorText" class="review__error">
      {{ errorText }}
      <el-button text type="primary" size="small" @click="load">重试</el-button>
    </p>

    <div v-else-if="loading" class="review__loading">
      <el-skeleton :rows="4" animated />
    </div>

    <el-empty v-else-if="items.length === 0" description="没有待审评论" :image-size="80" />

    <ul v-else class="review__list">
      <li v-for="item in items" :key="item.id" class="pending">
        <header class="pending__head">
          <AuthorTag :name="item.nickname" :deleted="item.author_deleted" />
          <time class="pending__time">{{ formatTime(item.created_at) }}</time>
          <button
            class="pending__target"
            type="button"
            title="打开这条记录的详情"
            @click="openTarget(item)"
          >
            {{ targetLabel(item) }}
          </button>
        </header>

        <p class="pending__text">{{ item.content }}</p>

        <footer class="pending__actions">
          <el-button
            size="small"
            :disabled="actingId === item.id"
            :loading="actingId === item.id"
            @click="reject(item)"
          >
            驳回
          </el-button>
          <el-button
            size="small"
            type="primary"
            :disabled="actingId === item.id"
            :loading="actingId === item.id"
            @click="approve(item)"
          >
            通过
          </el-button>
        </footer>
      </li>
    </ul>

    <template #footer>
      <span class="review__hint">通过后立即公开；驳回原因只有作者本人看得到</span>
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
  max-height: 60vh;
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

.pending__text {
  margin: 0;
  font-size: 0.9375rem;
  line-height: 1.7;
  color: var(--text-1);
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
