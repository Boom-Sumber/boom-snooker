<script setup lang="ts">
/**
 * 通知列表（T4.7）
 *
 * 只做一件事：把"你发的东西审过了"告诉作者。
 * 每条通知由数据库触发器在审核那一刻写入，客户端读自己的、点开即标已读。
 *
 * 为什么点通知跳的是**记录**详情而不是评论：
 * 评论挂在记录上，记录页底部就是评论区，跳过去能同时看到上下文和那条评论。
 */
import { computed, onMounted, ref, watch } from 'vue'
import { useRouter } from 'vue-router'
import { ElMessage } from 'element-plus'
import { useDatasetStore } from '@renderer/stores'
import {
  listNotifications,
  markNotificationsRead,
  type NotificationItem
} from '@shared/api/notifications'

const props = defineProps<{ refreshToken?: number }>()

const emit = defineEmits<{
  /** 已读状态变了：让顶部角标重新取数 */
  (event: 'changed'): void
  /** 点了某条通知，要关掉对话框 */
  (event: 'leave'): void
}>()

const router = useRouter()
const dataset = useDatasetStore()

const items = ref<NotificationItem[]>([])
const loading = ref(false)
const errorText = ref('')

const unreadCount = computed(() => items.value.filter((i) => !i.read_at).length)

function formatTime(raw: string): string {
  const date = new Date(raw)
  if (Number.isNaN(date.getTime())) return raw
  const pad = (n: number): string => String(n).padStart(2, '0')
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())} ${pad(date.getHours())}:${pad(date.getMinutes())}`
}

async function load(): Promise<void> {
  loading.value = true
  errorText.value = ''

  const result = await listNotifications({ limit: 30 })
  loading.value = false

  if (!result.ok) {
    errorText.value = result.message
    items.value = []
    return
  }
  items.value = result.data.items
}

/** 点一条：先标已读（失败也不挡跳转），再跳到记录详情 */
async function open(item: NotificationItem): Promise<void> {
  if (!item.read_at) {
    const result = await markNotificationsRead([item.id])
    if (result.ok) {
      item.read_at = new Date().toISOString()
      emit('changed')
    }
  }

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

onMounted(load)

watch(
  () => props.refreshToken,
  () => {
    void load()
  }
)
</script>

<template>
  <div class="notify">
    <div class="notify__bar">
      <span class="notify__hint">{{ unreadCount > 0 ? `${unreadCount} 条未读` : '没有未读' }}</span>
      <el-button text type="primary" size="small" :disabled="unreadCount === 0" @click="markAll">
        全部已读
      </el-button>
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
              <el-tag v-if="item.kind.endsWith('rejected')" size="small" type="info" effect="plain">
                未通过
              </el-tag>
              <el-tag v-else size="small" type="success" effect="plain">已通过</el-tag>
            </span>
            <span v-if="item.body" class="note__text">{{ item.body }}</span>
            <span class="note__time">{{ formatTime(item.created_at) }}</span>
          </span>
        </button>
      </li>
    </ul>
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
  gap: 0.5rem;
  width: 100%;
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
  overflow-wrap: anywhere;
}

.note__time {
  font-size: var(--font-size-sm);
  color: var(--text-3);
}
</style>
