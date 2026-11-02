<script setup lang="ts">
/**
 * 通知列表（T4.7 / T4.8 / T4.9）
 *
 * 同一个组件用在两处：
 *   · 通知中心弹窗（按 `scope` 分成「审核结果」「系统通知」两栏）
 *   · 更多 → 通知页（`scope="all"`，可筛选、可删除）
 *
 * 通知只属于本人：列表、审核人、驳回原因都由服务端按 `auth.uid()` 过滤，前端不做权限判断。
 */
import { computed, onMounted, ref, watch } from 'vue'
import { useRouter } from 'vue-router'
import { ElMessage, ElMessageBox } from 'element-plus'
import { useDatasetStore } from '@renderer/stores'
import {
  clearReadNotifications,
  deleteNotification,
  listNotifications,
  markNotificationsRead,
  type NotificationItem,
  type NotificationScope
} from '@shared/api/notifications'

const props = withDefaults(
  defineProps<{
    scope?: NotificationScope
    /** 每次 +1 强制重拉（弹窗打开 / 页面刷新） */
    refreshToken?: number
    pageSize?: number
    /** 独立页面才显示「清空已读」，弹窗里不显示 */
    showClearRead?: boolean
  }>(),
  { scope: 'all', pageSize: 20, showClearRead: false }
)

const emit = defineEmits<{
  /** 已读 / 删除后数量变了：让顶部角标重新取数 */
  (event: 'changed'): void
  /** 点了某条通知，要关掉弹窗 */
  (event: 'leave'): void
}>()

const router = useRouter()
const dataset = useDatasetStore()

const items = ref<NotificationItem[]>([])
const loading = ref(false)
const loadingMore = ref(false)
const errorText = ref('')

const unreadCount = computed(() => items.value.filter((i) => !i.read_at).length)
const hasMore = computed(() => items.value.length > 0 && items.value.length < items.value[0].total)

function formatTime(raw: string | null): string {
  if (!raw) return ''
  const date = new Date(raw)
  if (Number.isNaN(date.getTime())) return raw
  const pad = (n: number): string => String(n).padStart(2, '0')
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())} ${pad(date.getHours())}:${pad(date.getMinutes())}`
}

async function load(): Promise<void> {
  loading.value = true
  errorText.value = ''

  const result = await listNotifications({ limit: props.pageSize, scope: props.scope })
  loading.value = false

  if (!result.ok) {
    errorText.value = result.message
    items.value = []
    return
  }
  items.value = result.data.items
}

async function loadMore(): Promise<void> {
  if (loadingMore.value || !hasMore.value) return
  loadingMore.value = true

  const result = await listNotifications({
    limit: props.pageSize,
    offset: items.value.length,
    scope: props.scope
  })
  loadingMore.value = false

  if (!result.ok) {
    ElMessage.error(result.message)
    return
  }
  items.value = [...items.value, ...result.data.items]
}

/** 点一条：先标已读（失败也不挡跳转），再按类型决定跳不跳 */
async function open(item: NotificationItem): Promise<void> {
  if (!item.read_at) {
    const result = await markNotificationsRead([item.id])
    if (result.ok) {
      item.read_at = new Date().toISOString()
      emit('changed')
    }
  }

  // 系统通知没有目标记录，只标已读
  if (!item.target_type || !item.target_id) return

  // 通知里只有 id，路由需要颜色 / 系列，从快照里找
  const route =
    item.target_type === 'ball'
      ? dataset.findBall(item.target_id) &&
        `/balls/${dataset.findBall(item.target_id)?.color_code}/${item.target_id}`
      : dataset.findAdvanced(item.target_id) &&
        `/advanced/${dataset.findAdvanced(item.target_id)?.category_code}/${item.target_id}`

  if (!route) {
    // 记录被驳回 / 已删除：快照里没有，详情页也打不开，别把人带到空页面
    ElMessage.info('这条内容没有公开，无法查看')
    return
  }

  emit('leave')
  void router.push(route)
}

async function remove(item: NotificationItem): Promise<void> {
  const confirmed = await ElMessageBox.confirm(
    '删除后这条通知就找不回来了，确定删除吗？',
    '删除通知',
    { type: 'warning', confirmButtonText: '删除', cancelButtonText: '取消' }
  ).catch(() => false)
  if (!confirmed) return

  const result = await deleteNotification(item.id)
  if (!result.ok) {
    ElMessage.error(result.message)
    return
  }
  items.value = items.value.filter((i) => i.id !== item.id)
  emit('changed')
}

async function markAll(): Promise<void> {
  const result = await markNotificationsRead()
  if (!result.ok) {
    ElMessage.error(result.message)
    return
  }
  ElMessage.success('已全部标为已读')
  emit('changed')
  await load()
}

async function clearRead(): Promise<void> {
  const confirmed = await ElMessageBox.confirm(
    '会删除所有已读通知，未读的保留。确定继续吗？',
    '清空已读',
    { type: 'warning', confirmButtonText: '清空', cancelButtonText: '取消' }
  ).catch(() => false)
  if (!confirmed) return

  const result = await clearReadNotifications()
  if (!result.ok) {
    ElMessage.error(result.message)
    return
  }
  ElMessage.success(`已清空 ${result.data} 条已读通知`)
  emit('changed')
  await load()
}

onMounted(load)

watch(
  () => [props.refreshToken, props.scope],
  () => {
    void load()
  }
)
</script>

<template>
  <div class="notify">
    <div class="notify__bar">
      <span class="notify__hint">{{ unreadCount > 0 ? `${unreadCount} 条未读` : '没有未读' }}</span>
      <div class="notify__ops">
        <el-button v-if="showClearRead" text type="primary" size="small" @click="clearRead">
          清空已读
        </el-button>
        <el-button text type="primary" size="small" :disabled="unreadCount === 0" @click="markAll">
          全部已读
        </el-button>
      </div>
    </div>

    <p v-if="errorText" class="notify__error">
      {{ errorText }}
      <el-button text type="primary" size="small" @click="load">重试</el-button>
    </p>

    <div v-else-if="loading" class="notify__loading">
      <el-skeleton :rows="3" animated />
    </div>

    <el-empty v-else-if="items.length === 0" description="还没有通知" :image-size="72" />

    <ul v-else class="notify__list">
      <li
        v-for="item in items"
        :key="item.id"
        class="note"
        :class="{ 'note--unread': !item.read_at }"
      >
        <button class="note__main" type="button" @click="open(item)">
          <span class="note__dot" aria-hidden="true" />
          <span class="note__body">
            <span class="note__title">
              {{ item.title }}
              <el-tag v-if="item.kind === 'system'" size="small" type="warning" effect="plain">
                系统
              </el-tag>
              <el-tag
                v-else-if="item.kind.endsWith('rejected')"
                size="small"
                type="info"
                effect="plain"
              >
                未通过
              </el-tag>
              <el-tag v-else size="small" type="success" effect="plain">已通过</el-tag>
            </span>
            <span v-if="item.body" class="note__text">{{ item.body }}</span>
            <span class="note__meta">
              <!-- 审核人 + 审核时间：只有通知所有者能看到（T4.10）；系统通知显示发布人与发布时间 -->
              <template v-if="item.kind === 'system'">
                <span v-if="item.reviewer_name">发布人：{{ item.reviewer_name }}</span>
                <span class="note__time">{{ formatTime(item.created_at) }}</span>
              </template>
              <template v-else>
                <span v-if="item.reviewer_name">审核人：{{ item.reviewer_name }}</span>
                <span v-if="item.reviewed_at">审核时间：{{ formatTime(item.reviewed_at) }}</span>
                <span v-else class="note__time">{{ formatTime(item.created_at) }}</span>
              </template>
            </span>
          </span>
        </button>

        <button class="note__del" type="button" title="删除这条通知" @click="remove(item)">
          删除
        </button>
      </li>
    </ul>

    <el-button v-if="hasMore" text type="primary" :loading="loadingMore" @click="loadMore">
      加载更多
    </el-button>
  </div>
</template>

<style scoped>
.notify {
  display: flex;
  flex-direction: column;
  gap: 0.5rem;
}

.notify__bar {
  display: flex;
  align-items: center;
  justify-content: space-between;
}

.notify__ops {
  display: flex;
  gap: 0.25rem;
}

.notify__hint {
  font-size: var(--font-size-sm);
  color: var(--text-3);
}

.notify__error {
  display: flex;
  gap: 0.5rem;
  align-items: center;
  margin: 0;
  font-size: var(--font-size-sm);
  color: var(--text-2);
}

.notify__list {
  display: flex;
  flex-direction: column;
  gap: 0.5rem;
  max-height: 56vh;
  padding: 0;
  margin: 0;
  overflow-y: auto;
  list-style: none;
}

.note {
  display: flex;
  align-items: stretch;
  background: var(--surface-2);
  border: 1px solid var(--border);
  border-radius: var(--radius-md);
}

/* 未读：左侧留一条主题色细边，不用大红点（角标已经在顶栏了） */
.note--unread {
  border-left: 3px solid var(--primary);
}

.note__main {
  display: flex;
  flex: 1;
  gap: 0.5rem;
  min-width: 0;
  padding: 0.625rem 0.75rem;
  text-align: left;
  cursor: pointer;
  background: transparent;
  border: 0;
}

.note__dot {
  flex: none;
  width: 0.375rem;
  height: 0.375rem;
  margin-top: 0.5rem;
  background: transparent;
  border-radius: 50%;
}

.note--unread .note__dot {
  background: var(--primary);
}

.note__body {
  display: flex;
  flex-direction: column;
  gap: 0.125rem;
  min-width: 0;
}

.note__title {
  display: flex;
  flex-wrap: wrap;
  gap: 0.375rem;
  align-items: center;
  font-size: 0.9375rem;
  color: var(--text-1);
}

.note__text {
  font-size: var(--font-size-sm);
  line-height: 1.6;
  color: var(--text-2);
  white-space: pre-wrap;
  overflow-wrap: anywhere;
}

.note__meta {
  display: flex;
  flex-wrap: wrap;
  gap: 0.125rem 0.75rem;
  font-size: var(--font-size-sm);
  color: var(--text-3);
}

.note__time {
  color: var(--text-3);
}

/* 删除按钮平时淡一点，别抢通知正文 */
.note__del {
  flex: none;
  padding: 0 0.625rem;
  font-size: var(--font-size-sm);
  color: var(--text-3);
  cursor: pointer;
  background: transparent;
  border: 0;
  border-left: 1px solid var(--border);
}

.note__del:hover {
  color: #f56c6c;
}
</style>
