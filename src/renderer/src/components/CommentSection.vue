<script setup lang="ts">
/**
 * 评论区（T4.2）
 *
 * 挂在**详情页底部**（彩球 / 进阶共用），不是列表卡片里 ——
 * 列表页只做浏览索引，评论、大图、长文都在详情页（docs/04 §5.6）。
 *
 * 三件事：
 *   1. 分页读：`list_comments`，最新在上，一次 10 条，不够再「加载更多」
 *   2. 发一条：`create_comment`，服务端强制 `pending`，界面立刻能看到自己的「审核中」
 *   3. 公开数：标题旁的条数用 `get_comment_counts`（**只数 visible**），
 *      所以待审评论不会让公开数虚高 —— 这是 T4.2 的验收点之一
 *
 * 为什么匿名也能看到列表：D22 允许未登录读已过审评论，写操作才要登录。
 * 未登录时输入区换成「去登录」，不做假输入框（点了发不出去更烦）。
 *
 * 评论不进快照（铁律 6），所以这一块**必须联网**；断网时给出明确提示 + 重试，
 * 不能让页面看起来像"没有评论"。
 */
import { computed, onMounted, ref, watch } from 'vue'
import { useRouter } from 'vue-router'
import { ElMessage } from 'element-plus'
import AuthorTag from './AuthorTag.vue'
import ReviewStamp from './ReviewStamp.vue'
import { resolveAvatar } from '@renderer/assets/avatars'
import { useAuthStore, useNetworkStore } from '@renderer/stores'
import {
  createComment,
  getCommentCounts,
  listComments,
  type CommentItem,
  type CommentTargetType
} from '@shared/api/comments'

const props = defineProps<{
  /** 评论挂在哪类内容上 */
  type: CommentTargetType
  /** 目标记录 id */
  targetId: string
}>()

const router = useRouter()
const auth = useAuthStore()
/** 离线时禁用发送（T6.1）：评论必须联网写，草稿保留在输入框里 */
const network = useNetworkStore()

/** 一页 10 条：评论正文最长 300 字，10 条已经占满一屏多 */
const PAGE_SIZE = 10

const items = ref<CommentItem[]>([])
/** 当前调用者可见的总条数（含自己的待审），只用于判断「还有没有下一页」 */
const total = ref(0)
/** 公开条数（只数 visible），标题旁显示这个 */
const publicCount = ref(0)
const loading = ref(false)
const loadingMore = ref(false)
const errorText = ref('')

const draft = ref('')
const submitting = ref(false)

const hasMore = computed(() => items.value.length > 0 && items.value.length < total.value)
const canSubmit = computed(
  () => auth.isSignedIn && !network.offline && draft.value.trim().length > 0 && !submitting.value
)

/** 自己还没过审 / 已被驳回的条数：标题旁各给一枚小胶囊，提醒"你的评论还没公开" */
const myPending = computed(
  () => items.value.filter((c) => c.user_id === auth.user?.id && c.status === 'pending').length
)
const myRejected = computed(
  () => items.value.filter((c) => c.user_id === auth.user?.id && c.status === 'rejected').length
)

function formatTime(raw: string): string {
  const date = new Date(raw)
  if (Number.isNaN(date.getTime())) return raw
  const pad = (n: number): string => String(n).padStart(2, '0')
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())} ${pad(date.getHours())}:${pad(date.getMinutes())}`
}

/** 首屏 / 重新加载：列表 + 公开数一起拉，避免条数和列表对不上 */
async function load(): Promise<void> {
  loading.value = true
  errorText.value = ''

  const [listResult, countResult] = await Promise.all([
    listComments(props.type, props.targetId, { limit: PAGE_SIZE, offset: 0 }),
    getCommentCounts(props.type, [props.targetId])
  ])

  loading.value = false

  if (!listResult.ok) {
    errorText.value = listResult.message
    items.value = []
    total.value = 0
    return
  }

  items.value = listResult.data.items
  total.value = listResult.data.total
  publicCount.value = countResult.ok
    ? (countResult.data.get(props.targetId) ?? 0)
    : // 计数接口失败不该让列表跟着挂，退回"本页 visible 条数"这种保守值
      items.value.filter((c) => c.status === 'visible').length
}

async function loadMore(): Promise<void> {
  if (loadingMore.value || !hasMore.value) return
  loadingMore.value = true

  const result = await listComments(props.type, props.targetId, {
    limit: PAGE_SIZE,
    offset: items.value.length
  })
  loadingMore.value = false

  if (!result.ok) {
    ElMessage.error(result.message)
    return
  }

  items.value = [...items.value, ...result.data.items]
  total.value = result.data.total || total.value
}

async function submit(): Promise<void> {
  const text = draft.value.trim()
  if (!text || submitting.value) return

  submitting.value = true
  const result = await createComment(props.type, props.targetId, text)
  submitting.value = false

  if (!result.ok) {
    ElMessage.error(result.message)
    return
  }

  draft.value = ''
  ElMessage.success('已提交，审核通过后公开显示')
  // 重新拉第一页：自己的 pending 会带着「审核中」标签出现在列表里
  await load()
}

function goLogin(): void {
  void router.push('/account')
}

onMounted(load)

// 详情页之间切换（上一条 / 下一条）时组件会复用，必须按新 id 重拉
watch(
  () => [props.type, props.targetId],
  () => {
    items.value = []
    total.value = 0
    publicCount.value = 0
    draft.value = ''
    void load()
  }
)

/**
 * 登录 / 登出后必须重拉
 *
 * 可见范围是跟着身份变的：登出后自己的待审/驳回评论不该还留在列表里，
 * 登录后又要能看到自己的待审。不重拉就会出现"匿名还能看到自己那条驳回评论"
 * ——服务端没漏，是界面拿了旧数据。
 */
watch(
  () => auth.user?.id ?? null,
  () => {
    items.value = []
    total.value = 0
    void load()
  }
)
</script>

<template>
  <section class="comments card">
    <header class="comments__head">
      <h2 class="comments__title">评论</h2>
      <span class="comments__count">{{ publicCount }}</span>
      <span v-if="myPending > 0" class="comments__pending">{{ myPending }} 条审核中</span>
      <span v-if="myRejected > 0" class="comments__pending comments__pending--muted">
        {{ myRejected }} 条未通过
      </span>
    </header>

    <p v-if="errorText" class="comments__error">
      {{ errorText }}
      <el-button text type="primary" size="small" @click="load">重试</el-button>
    </p>

    <div v-else-if="loading" class="comments__skeleton">
      <el-skeleton :rows="3" animated />
    </div>

    <p v-else-if="items.length === 0" class="comments__empty">还没有评论，来说两句</p>

    <ul v-else class="comments__list">
      <li v-for="item in items" :key="item.id" class="comment">
        <el-avatar :size="32" :src="resolveAvatar(item.avatar, item.gender)" />
        <div class="comment__main">
          <div class="comment__meta">
            <AuthorTag :name="item.nickname" :deleted="item.author_deleted" />
            <time class="comment__time">{{ formatTime(item.created_at) }}</time>
            <el-tag v-if="item.status === 'pending'" size="small" type="warning" effect="plain">
              审核中
            </el-tag>
            <el-tag v-else-if="item.status === 'rejected'" size="small" type="info" effect="plain">
              未通过
            </el-tag>
          </div>
          <p class="comment__text">{{ item.content }}</p>
          <p v-if="item.status === 'rejected' && item.review_note" class="comment__note">
            驳回原因：{{ item.review_note }}
          </p>
          <!-- 审核回显：服务端只回给自己的评论（T4.10 / T4.13） -->
          <ReviewStamp
            v-if="item.status !== 'pending' && item.reviewed_at"
            :name="item.reviewer_name"
            :role="item.reviewer_role"
            :at="item.reviewed_at"
            :status="item.status === 'rejected' ? 'rejected' : 'visible'"
          />
        </div>
      </li>
    </ul>

    <el-button v-if="hasMore" text type="primary" :loading="loadingMore" @click="loadMore">
      加载更多
    </el-button>

    <!-- 输入区：登录才给输入框，未登录直接引导去登录 -->
    <!-- D35：超管只做全局管控，不参与评论（审核评论走审核队列） -->
    <div v-if="auth.isSignedIn && !auth.isSuperadmin" class="comments__composer">
      <el-input
        v-model="draft"
        type="textarea"
        :rows="3"
        maxlength="300"
        show-word-limit
        resize="none"
        placeholder="说说你的看法…"
      />
      <div class="comments__actions">
        <span class="comments__hint">
          {{
            network.offline
              ? '离线状态下无法发表评论，恢复网络后可直接发送'
              : '提交后由管理员审核，通过后才公开显示'
          }}
        </span>
        <el-button type="primary" :disabled="!canSubmit" :loading="submitting" @click="submit">
          发送
        </el-button>
      </div>
    </div>

    <div v-else-if="auth.isSuperadmin" class="comments__signin">
      <span class="comments__hint">超级管理员不参与评论；评论请在审核队列里处理</span>
    </div>

    <div v-else class="comments__signin">
      <span class="comments__hint">登录后才能评论</span>
      <el-button type="primary" plain size="small" @click="goLogin">去登录</el-button>
    </div>
  </section>
</template>

<style scoped>
.comments {
  display: flex;
  flex-direction: column;
  gap: 0.75rem;
  padding: clamp(1rem, 1.6vw, 1.75rem);
}

.comments__head {
  display: flex;
  flex-wrap: wrap;
  gap: 0.5rem;
  align-items: baseline;
}

.comments__title {
  margin: 0;
  font-size: 1rem;
  font-weight: 500;
  color: var(--text-1);
}

/* 公开条数：只数 visible，待审的不算进来 */
.comments__count {
  font-size: var(--font-size-sm);
  color: var(--text-3);
}

.comments__pending {
  padding: 0 0.375rem;
  font-size: var(--font-size-sm);
  line-height: 1.5;
  color: var(--primary);
  background: color-mix(in srgb, var(--primary) 12%, transparent);
  border-radius: 999px;
}

/* 驳回的那枚用灰底，和「审核中」区分开 */
.comments__pending--muted {
  color: var(--text-2);
  background: var(--surface-2);
}

.comments__error {
  display: flex;
  gap: 0.5rem;
  align-items: center;
  margin: 0;
  font-size: var(--font-size-sm);
  color: var(--text-2);
}

.comments__empty {
  margin: 0;
  padding: 1.5rem 0;
  font-size: var(--font-size-sm);
  color: var(--text-3);
  text-align: center;
}

.comments__list {
  display: flex;
  flex-direction: column;
  gap: 1rem;
  padding: 0;
  margin: 0;
  list-style: none;
}

.comment {
  display: flex;
  gap: 0.75rem;
  align-items: flex-start;
}

.comment__main {
  display: flex;
  flex: 1;
  flex-direction: column;
  gap: 0.25rem;
  min-width: 0;
}

.comment__meta {
  display: flex;
  flex-wrap: wrap;
  gap: 0.5rem;
  align-items: center;
  font-size: var(--font-size-sm);
  color: var(--text-2);
}

.comment__time {
  color: var(--text-3);
}

.comment__text {
  margin: 0;
  font-size: 0.9375rem;
  line-height: 1.7;
  color: var(--text-1);
  white-space: pre-wrap;
  overflow-wrap: anywhere;
}

/* 驳回原因只在自己那条上出现（服务端也只回给自己的评论） */
.comment__note {
  margin: 0;
  font-size: var(--font-size-sm);
  color: var(--text-3);
}

.comments__composer {
  display: flex;
  flex-direction: column;
  gap: 0.5rem;
  padding-top: 0.75rem;
  border-top: 1px solid var(--border);
}

.comments__actions {
  display: flex;
  flex-wrap: wrap;
  gap: 0.75rem;
  align-items: center;
  justify-content: space-between;
}

.comments__hint {
  font-size: var(--font-size-sm);
  color: var(--text-3);
}

.comments__signin {
  display: flex;
  flex-wrap: wrap;
  gap: 0.75rem;
  align-items: center;
  justify-content: space-between;
  padding-top: 0.75rem;
  border-top: 1px solid var(--border);
}
</style>
