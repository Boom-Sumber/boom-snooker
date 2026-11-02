<script setup lang="ts">
/**
 * 进阶条目详情页
 *
 * 列表页的卡片只做索引（图 + 标题 + 作者 + 日期），完整内容在这里：
 * 大图（可点开原尺寸）、描述、注解。
 *
 * 评论区（T4.2）也挂在这一页底部，是独立卡片：评论不进快照，必须联网取。
 *
 * 数据不额外请求：按 id 从本地快照里取（`dataset.findAdvanced`），
 * 离线也能看；取不到时区分「还没同步完」和「确实不存在」。
 */
import { computed, ref, watch } from 'vue'
import { useRouter } from 'vue-router'
import { ElImageViewer, ElMessage, ElMessageBox } from 'element-plus'
import { ArrowLeftBold } from '@element-plus/icons-vue'
import AdvancedFormDialog from '@renderer/components/AdvancedFormDialog.vue'
import CommentSection from '@renderer/components/CommentSection.vue'
import { CATEGORY_LABELS } from '@renderer/navigation/menu'
import { useAuthStore, useDatasetStore, type Advanced } from '@renderer/stores'
import { imageUrl } from '@shared/media/url'
import { deleteAdvanced } from '@shared/api/advanced'
import { getReviewAdvanced, reviewRecord } from '@shared/api/review'
import { getMyAdvanced, type AdvancedWithReview, type ReviewStatus } from '@shared/api/myRecords'
import ReviewStamp from '@renderer/components/ReviewStamp.vue'
import AuthorTag from '@renderer/components/AuthorTag.vue'

const props = defineProps<{ category: string; id: string }>()

const router = useRouter()
const dataset = useDatasetStore()
const auth = useAuthStore()

/**
 * 审核预览 / 作者预览（T4.6 / T4.12）
 *
 * 待审与驳回的记录不在快照里，按 id 单独拉：
 *   · 是我自己的 → `get_my_record`（带审核人信息），作者能看见自己的待审 / 驳回内容
 *   · 不是我的 + 我是管理员 → `get_review_record`（审核预览，带通过 / 驳回按钮）
 */
const myItem = ref<AdvancedWithReview | null>(null)
const reviewItem = ref<Advanced | null>(null)
const extraLoading = ref(false)
const reviewError = ref('')

const inSnapshot = computed(() => dataset.findAdvanced(props.id))
const item = computed<Advanced | null>(
  () => inSnapshot.value ?? (myItem.value as Advanced | null) ?? reviewItem.value
)

const isMine = computed(() =>
  Boolean(item.value?.owner_id && item.value.owner_id === auth.user?.id)
)
const myStatus = computed<ReviewStatus | null>(
  () => (myItem.value?.review_status as ReviewStatus | undefined) ?? null
)
const isPending = computed(() => isMine.value && myStatus.value === 'pending')
const isRejected = computed(() => isMine.value && myStatus.value === 'rejected')

const isReview = computed(() => !inSnapshot.value && !isMine.value && reviewItem.value !== null)

async function loadExtra(): Promise<void> {
  if (!dataset.isReady) return

  const snapshot = dataset.findAdvanced(props.id)

  if (snapshot) {
    if (auth.isSignedIn && snapshot.owner_id === auth.user?.id) {
      const mine = await getMyAdvanced(props.id)
      if (mine.ok) myItem.value = mine.data
    }
    return
  }

  if (!auth.isSignedIn) return

  extraLoading.value = true
  reviewError.value = ''

  const mine = await getMyAdvanced(props.id)
  if (mine.ok) {
    myItem.value = mine.data
    extraLoading.value = false
    return
  }

  if (auth.isAdmin) {
    const result = await getReviewAdvanced(props.id)
    extraLoading.value = false
    if (!result.ok) {
      reviewError.value = result.message
      return
    }
    reviewItem.value = result.data as Advanced
    return
  }

  extraLoading.value = false
}

async function approveReview(): Promise<void> {
  if (!reviewItem.value) return
  const result = await reviewRecord('advanced', reviewItem.value.id, 'visible')
  if (!result.ok) {
    ElMessage.error(result.message)
    return
  }
  ElMessage.success('已通过，这条进阶已发布')
  await dataset.sync(true)
  window.dispatchEvent(new Event('snooker:review-changed'))
  goBack()
}

async function rejectReview(): Promise<void> {
  if (!reviewItem.value) return

  const answer = await ElMessageBox.prompt('驳回原因会通知给作者', '驳回这条进阶', {
    confirmButtonText: '驳回',
    cancelButtonText: '取消',
    inputType: 'textarea',
    inputPlaceholder: '比如：图片不清晰 / 描述与图片不符',
    inputValidator: (value: string) => (value && value.length > 200 ? '最多 200 字' : true)
  }).catch(() => null)
  if (!answer) return

  const result = await reviewRecord('advanced', reviewItem.value.id, 'rejected', answer.value ?? '')
  if (!result.ok) {
    ElMessage.error(result.message)
    return
  }
  ElMessage.success('已驳回')
  window.dispatchEvent(new Event('snooker:review-changed'))
  goBack()
}

watch(
  // 四个都可能是"晚到"的：路由 id、快照、登录态、当前用户
  () => [props.id, dataset.isReady, auth.isAdmin, auth.user?.id],
  () => {
    myItem.value = null
    reviewItem.value = null
    reviewError.value = ''
    void loadExtra()
  },
  { immediate: true }
)

const categoryName = computed(
  () => CATEGORY_LABELS[props.category] ?? dataset.dictName('category', props.category)
)

const image = computed(() => (item.value ? imageUrl(item.value.image) : ''))

const viewerVisible = ref(false)
const formVisible = ref(false)

const updatedText = computed(() => {
  const raw = item.value?.updated_at
  if (!raw) return ''
  const date = new Date(raw)
  if (Number.isNaN(date.getTime())) return raw
  const pad = (n: number): string => String(n).padStart(2, '0')
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())} ${pad(date.getHours())}:${pad(date.getMinutes())}`
})

/** 只有作者本人能改/删（服务端 RPC 也是这么卡的，管理员也不行） */
const canManage = computed(() => {
  const record = item.value
  return Boolean(
    auth.canWrite && record && record.owner_id !== null && record.owner_id === auth.user?.id
  )
})

function goBack(): void {
  void router.push(`/advanced/${props.category}`)
}

async function onDelete(): Promise<void> {
  const record = item.value
  if (!record) return

  const confirmed = await ElMessageBox.confirm(
    '删除后该条进阶会从列表里消失（服务端是软删除）。确定删除吗？',
    '删除确认',
    { type: 'warning', confirmButtonText: '删除', cancelButtonText: '取消' }
  ).catch(() => false)
  if (!confirmed) return

  const result = await deleteAdvanced(record.id, dataset.version)
  if (!result.ok) {
    if (result.conflict) void dataset.sync(true)
    ElMessage.error(result.message ?? '删除失败')
    return
  }

  ElMessage.success('已删除')
  await dataset.sync(true)
  goBack()
}

async function onSaved(): Promise<void> {
  await dataset.sync(true)
  // 编辑后可能从 rejected 变回 pending，状态条要跟着变
  myItem.value = null
  void loadExtra()
}
</script>

<template>
  <section class="detail">
    <header class="detail__bar">
      <el-button text class="detail__back" @click="goBack">
        <span class="detail__back-inner">
          <el-icon><ArrowLeftBold /></el-icon>
          <span>返回{{ categoryName }}</span>
        </span>
      </el-button>

      <!-- 待审期间不能改内容（服务端也会拒 PENDING_LOCKED），但允许删除 -->
      <div v-if="canManage && !isReview" class="detail__actions">
        <el-button v-if="!isPending" @click="formVisible = true">编辑</el-button>
        <el-button type="danger" plain @click="onDelete">删除</el-button>
      </div>
    </header>

    <div v-if="!dataset.isReady || extraLoading" class="state">
      <el-skeleton :rows="5" animated />
      <p class="state__text">数据还没同步完成，稍等一下…</p>
    </div>

    <el-empty v-else-if="!item" :description="reviewError || '这条记录不存在，或已被作者删除'">
      <el-button type="primary" @click="goBack">返回列表</el-button>
    </el-empty>

    <article v-else class="detail__body card">
      <!-- 作者视角：待审 / 驳回时的状态条（T4.12 / T4.13） -->
      <div v-if="isPending" class="status-bar">
        <span class="status-bar__text">这条进阶正在审核中，审核期间不能修改</span>
        <el-tag size="small" type="warning" effect="plain">待审核</el-tag>
      </div>
      <div v-else-if="isRejected" class="status-bar status-bar--rejected">
        <div class="status-bar__main">
          <span class="status-bar__text">
            未通过审核<template v-if="myItem?.review_note">：{{ myItem.review_note }}</template>
          </span>
          <ReviewStamp
            :name="myItem?.reviewer_name"
            :role="myItem?.reviewer_role"
            :at="myItem?.reviewed_at"
            status="rejected"
          />
        </div>
        <span class="status-bar__text">可以修改后重新提交审核</span>
      </div>

      <!-- 审核预览：快照里没有的待审记录，看完直接通过/驳回 -->
      <div v-if="isReview" class="review-bar">
        <span class="review-bar__text">这条进阶还没通过审核，下面是完整预览（含大图）</span>
        <div class="review-bar__actions">
          <el-button size="small" @click="rejectReview">驳回</el-button>
          <el-button size="small" type="primary" @click="approveReview">通过</el-button>
        </div>
      </div>

      <h1 class="detail__title">{{ item.title }}</h1>
      <p class="detail__meta">
        <span>作者：<AuthorTag :name="item.updated_by" :deleted="item.author_deleted" /></span>
        <span>更新时间：{{ updatedText }}</span>
      </p>

      <!-- 已发布 + 是我自己的：显示审核回显（别人看不到） -->
      <ReviewStamp
        v-if="isMine && !isPending && !isRejected && myItem?.reviewed_at"
        :name="myItem?.reviewer_name"
        :role="myItem?.reviewer_role"
        :at="myItem?.reviewed_at"
        status="visible"
      />

      <button
        class="detail__media"
        type="button"
        :disabled="!image"
        :title="image ? '查看大图' : '暂无图片'"
        @click="viewerVisible = true"
      >
        <img v-if="image" :src="image" :alt="item.title" />
        <span v-else class="detail__empty">无图片</span>
      </button>

      <dl class="detail__fields">
        <div class="field">
          <dt>描述</dt>
          <dd>{{ item.description || '—' }}</dd>
        </div>
        <div class="field">
          <dt>注解</dt>
          <dd>{{ item.content || '—' }}</dd>
        </div>
      </dl>

      <!-- 评论区（T4.2）在下方独立区块，不放在卡片里 -->
    </article>

    <CommentSection
      v-if="dataset.isReady && item && inSnapshot"
      class="detail__comments"
      type="advanced"
      :target-id="item.id"
    />

    <ElImageViewer
      v-if="viewerVisible && image"
      :url-list="[image]"
      teleported
      @close="viewerVisible = false"
    />

    <AdvancedFormDialog
      v-model:visible="formVisible"
      :item="item"
      :default-category="category"
      @saved="onSaved"
    />
  </section>
</template>

<style scoped>
.detail {
  display: flex;
  flex-direction: column;
  gap: 0.875rem;
  padding: clamp(16px, 2.2vw, 28px);
}

.detail__bar {
  display: flex;
  gap: 1rem;
  align-items: center;
  justify-content: space-between;
}

.detail__back {
  padding-left: 0;
  font-size: var(--font-size-sm);
  color: var(--text-2);
}

/* 图标与文字之间留出 0.5rem，比 EP 默认的 6px 松一点 */
.detail__back-inner {
  display: inline-flex;
  gap: 0.5rem;
  align-items: center;
}

.detail__back-inner .el-icon {
  font-size: 1rem;
}

.detail__actions {
  display: flex;
  gap: 0.5rem;
}

/* 正文限宽：注解可能很长，一行铺满整窗会很难读 */
.detail__body {
  display: flex;
  flex-direction: column;
  gap: 0.875rem;
  width: 100%;
  max-width: 56rem;
  margin-inline: auto;
  padding: clamp(1rem, 1.6vw, 1.75rem);
}

.detail__title {
  margin: 0;
  font-size: clamp(1.25rem, 1.7vw, 1.5rem);
  font-weight: 500;
  line-height: 1.4;
  color: var(--text-1);
  overflow-wrap: anywhere;
}

.detail__meta {
  display: flex;
  flex-wrap: wrap;
  gap: 0.25rem 1.25rem;
  margin: 0;
  font-size: var(--font-size-sm);
  color: var(--text-2);
}

.detail__media {
  display: grid;
  place-items: center;
  width: 100%;
  padding: 0;
  overflow: hidden;
  cursor: zoom-in;
  /* 不要白色底衬：暗色主题下一大块白很突兀，图本身自带背景就够 */
  background: transparent;
  border: 0;
  border-radius: var(--radius-md);
}

.detail__media:disabled {
  cursor: default;
}

.detail__media img {
  max-width: 100%;
  max-height: 60vh;
  object-fit: contain;
}

.detail__empty {
  width: 100%;
  padding: 2rem 0;
  font-size: var(--font-size-sm);
  color: var(--text-3);
  text-align: center;
  border: 1px dashed var(--border);
  border-radius: var(--radius-md);
}

.detail__fields {
  display: flex;
  flex-direction: column;
  gap: 1rem;
  margin: 0;
}

.field dt {
  margin-bottom: 0.25rem;
  font-size: var(--font-size-sm);
  color: var(--text-3);
}

.field dd {
  margin: 0;
  font-size: 0.9375rem;
  line-height: 1.8;
  color: var(--text-1);
  /* 注解里可能有手工换行 */
  white-space: pre-wrap;
  overflow-wrap: anywhere;
}

/* 作者视角的状态条：待审 / 未通过 */
.status-bar {
  display: flex;
  flex-wrap: wrap;
  gap: 0.5rem;
  align-items: center;
  justify-content: space-between;
  padding: 0.5rem 0.75rem;
  font-size: var(--font-size-sm);
  color: var(--text-1);
  background: color-mix(in srgb, var(--warning, #e9af20) 12%, transparent);
  border: 1px solid color-mix(in srgb, var(--warning, #e9af20) 35%, transparent);
  border-radius: var(--radius-md);
}

.status-bar--rejected {
  background: var(--surface-2);
  border-color: var(--border);
}

.status-bar__main {
  display: flex;
  flex-wrap: wrap;
  gap: 0.5rem;
  align-items: center;
}

/* 审核预览条 */
.review-bar {
  display: flex;
  flex-wrap: wrap;
  gap: 0.75rem;
  align-items: center;
  justify-content: space-between;
  padding: 0.5rem 0.75rem;
  font-size: var(--font-size-sm);
  color: var(--text-1);
  background: color-mix(in srgb, var(--primary) 10%, transparent);
  border: 1px solid color-mix(in srgb, var(--primary) 35%, transparent);
  border-radius: var(--radius-md);
}

.review-bar__actions {
  display: flex;
  gap: 0.5rem;
}

/* 评论区：与正文同宽，挂在页面底部 */
.detail__comments {
  width: 100%;
  max-width: 56rem;
  margin-inline: auto;
}

.state {
  display: flex;
  flex-direction: column;
  gap: 0.5rem;
}

.state__text {
  margin: 0;
  font-size: var(--font-size-sm);
  color: var(--text-3);
}
</style>
