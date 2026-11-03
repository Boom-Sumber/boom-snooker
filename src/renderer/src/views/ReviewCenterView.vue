<script setup lang="ts">
/**
 * 审核中心（T8.4）
 *
 * 为什么单独开一页，而不是塞进通知弹窗：
 *   · 弹窗是「快速处理」入口，空间小，塞三类队列会挤成一团
 *   · 已驳回队列要做 72h 视觉催办、要显示缩略图与驳回原因，需要横向空间
 *   · 以后还要加「超时升级」「最近处理」，弹窗撑不住
 *
 * 三栏：
 *   · 待审评论 / 待审记录 —— 复用 `ReviewQueue`（传 `only` 隐藏它自己的页签栏）
 *   · 已驳回 —— `RejectedQueue`，管理员只能提醒，超管还能永久删除
 *
 * 底部「最近处理」：让管理员看到「超管代审了哪些」，避免重复处理。
 */
import { computed, onMounted, reactive, ref, watch } from 'vue'
import ReviewQueue from '@renderer/components/ReviewQueue.vue'
import RejectedQueue from '@renderer/components/RejectedQueue.vue'
import { ROLE_LABELS } from '@renderer/navigation/menu'
import { useAuthStore } from '@renderer/stores'
import { countPendingComments } from '@shared/api/comments'
import {
  countPendingRecords,
  listRecentReviews,
  listRejectedRecords,
  type RecentReview
} from '@shared/api/review'

const auth = useAuthStore()

const tab = ref<'comment' | 'record' | 'rejected'>('comment')
/** 子组件靠这个值变化重拉 */
const refreshToken = ref(0)

const counts = reactive({ comment: 0, record: 0, rejected: 0 })
const recent = ref<RecentReview[]>([])
const recentLoading = ref(false)
const recentError = ref('')

const canManage = computed(() => auth.isAdmin)

function formatTime(raw: string | null): string {
  if (!raw) return '—'
  const date = new Date(raw)
  if (Number.isNaN(date.getTime())) return raw
  const pad = (n: number): string => String(n).padStart(2, '0')
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())} ${pad(date.getHours())}:${pad(date.getMinutes())}`
}

function roleLabel(role: string | null): string {
  if (!role) return ''
  return ROLE_LABELS[role] ?? role
}

function decisionLabel(decision: 'visible' | 'rejected'): string {
  return decision === 'visible' ? '已通过' : '未通过'
}

async function loadCounts(): Promise<void> {
  // 计数失败不该打断页面，统一吞成 0
  const [comment, record, rejected] = await Promise.all([
    countPendingComments(),
    countPendingRecords(),
    listRejectedRecords({ limit: 1, offset: 0 })
  ])
  counts.comment = comment.ok ? comment.data : 0
  counts.record = record.ok ? record.data : 0
  counts.rejected = rejected.ok ? rejected.data.total : 0
}

async function loadRecent(): Promise<void> {
  recentLoading.value = true
  recentError.value = ''
  const result = await listRecentReviews(20)
  recentLoading.value = false
  if (!result.ok) {
    recentError.value = result.message
    recent.value = []
    return
  }
  recent.value = result.data
}

function refresh(): void {
  refreshToken.value += 1
  void loadCounts()
  void loadRecent()
}

/** 子组件处理完一条：刷新计数与最近处理 */
function onChanged(): void {
  void loadCounts()
  void loadRecent()
}

onMounted(() => {
  if (!canManage.value) return
  void loadCounts()
  void loadRecent()
})

// 首帧角色可能还没就绪（同回收站的坑），到位后补一次
watch(
  () => auth.isAdmin,
  (allowed) => {
    if (!allowed) return
    void loadCounts()
    void loadRecent()
  }
)
</script>

<template>
  <section class="review-center">
    <header class="head">
      <div>
        <h1 class="head__title">审核中心</h1>
        <p class="head__sub">
          待审的评论与记录、以及驳回后作者一直没处理的投稿都在这里。
          管理员只处理自己邀请的账户；超级管理员可以审全量，作为超时兜底。
        </p>
      </div>
      <div class="head__actions">
        <el-button :loading="recentLoading" @click="refresh">刷新</el-button>
      </div>
    </header>

    <div v-if="!canManage" class="card empty">
      <p class="empty__title">没有权限</p>
      <p class="empty__text">审核中心只对管理员和超级管理员开放。</p>
    </div>

    <template v-else>
      <section class="card body">
        <el-tabs v-model="tab">
          <el-tab-pane :label="`待审评论 ${counts.comment}`" name="comment">
            <ReviewQueue only="comment" :refresh-token="refreshToken" @changed="onChanged" />
          </el-tab-pane>

          <el-tab-pane :label="`待审记录 ${counts.record}`" name="record">
            <ReviewQueue only="record" :refresh-token="refreshToken" @changed="onChanged" />
          </el-tab-pane>

          <el-tab-pane :label="`已驳回 ${counts.rejected}`" name="rejected">
            <RejectedQueue :refresh-token="refreshToken" @changed="onChanged" />
          </el-tab-pane>
        </el-tabs>
      </section>

      <section class="card recent">
        <header class="recent__head">
          <h2 class="recent__title">最近处理</h2>
          <p class="recent__sub">
            谁审的、什么时候审的。带「超管代审」标记的说明是超级管理员替你处理的。
          </p>
        </header>

        <p v-if="recentError" class="recent__error">{{ recentError }}</p>
        <el-skeleton v-else-if="recentLoading" :rows="3" animated />
        <p v-else-if="recent.length === 0" class="recent__empty">还没有处理记录。</p>

        <ul v-else class="recent__list">
          <li v-for="item in recent" :key="`${item.rec_type}-${item.id}`" class="recent__item">
            <span class="recent__badge">{{ item.rec_type === 'ball' ? '彩球' : '进阶' }}</span>
            <span class="recent__name">{{ item.title || '（无标题）' }}</span>
            <span class="recent__meta">
              作者 {{ item.owner_nickname || '（未知）' }} · 由 {{ roleLabel(item.reviewer_role) }}
              {{ item.reviewer_nickname || '—' }} 审核 ·
              {{ formatTime(item.reviewed_at) }}
            </span>
            <el-tag
              v-if="item.reviewer_role === 'superadmin'"
              size="small"
              type="warning"
              effect="plain"
            >
              超管代审
            </el-tag>
            <el-tag
              size="small"
              :type="item.decision === 'visible' ? 'success' : 'danger'"
              effect="plain"
            >
              {{ decisionLabel(item.decision) }}
            </el-tag>
          </li>
        </ul>
      </section>
    </template>
  </section>
</template>

<style scoped>
.review-center {
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
  max-width: 48rem;
  margin: 0.25rem 0 0;
  font-size: var(--font-size-sm);
  line-height: 1.6;
  color: var(--text-2);
}

.head__actions {
  display: flex;
  flex: none;
  gap: 0.5rem;
}

.body {
  padding: 0.5rem 1rem 1rem;
}

.recent {
  display: flex;
  flex-direction: column;
  gap: 0.5rem;
  padding: 0.875rem 1rem 1rem;
}

.recent__head {
  display: flex;
  flex-wrap: wrap;
  gap: 0.25rem 0.75rem;
  align-items: baseline;
}

.recent__title {
  margin: 0;
  font-size: 1rem;
  font-weight: 500;
  color: var(--text-1);
}

.recent__sub {
  margin: 0;
  font-size: var(--font-size-sm);
  color: var(--text-3);
}

.recent__list {
  display: flex;
  flex-direction: column;
  gap: 0.375rem;
  padding: 0;
  margin: 0;
  list-style: none;
}

.recent__item {
  display: flex;
  flex-wrap: wrap;
  gap: 0.5rem;
  align-items: center;
  padding: 0.375rem 0;
  font-size: var(--font-size-sm);
  border-bottom: 1px solid var(--border);
}

.recent__item:last-child {
  border-bottom: none;
}

.recent__badge {
  padding: 0 0.375rem;
  color: var(--text-2);
  background: var(--surface-2);
  border: 1px solid var(--border);
  border-radius: 999px;
}

.recent__name {
  color: var(--text-1);
  overflow-wrap: anywhere;
}

.recent__meta {
  color: var(--text-2);
}

.recent__error,
.recent__empty {
  margin: 0;
  font-size: var(--font-size-sm);
  color: var(--text-3);
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
</style>
