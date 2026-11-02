<script setup lang="ts">
/**
 * 通知中心（T4.7）
 *
 * 顶部铃铛的统一入口，两个页签：
 *   · **通知**：我发的东西审过了没有（所有人可见）
 *   · **待审**：别人发的东西等不等我审（仅 admin / superadmin）
 *
 * 为什么要合成一个入口：作者和管理员可能是同一个人，
 * 两个铃铛并排会让人猜"哪个是哪个"。角标 = 未读通知 + 待审数。
 */
import { computed, ref, watch } from 'vue'
import NotificationList from './NotificationList.vue'
import ReviewQueue from './ReviewQueue.vue'
import { useAuthStore } from '@renderer/stores'
import { notificationCounts } from '@shared/api/notifications'

const props = defineProps<{
  visible: boolean
  /** 顶部角标轮询到的数量 */
  unreadCount?: number
  commentCount?: number
  recordCount?: number
}>()

const emit = defineEmits<{
  (event: 'update:visible', value: boolean): void
  /** 已读 / 审核状态变化：让顶部角标重新取数 */
  (event: 'changed'): void
}>()

const auth = useAuthStore()

const dialogVisible = computed({
  get: () => props.visible,
  set: (value: boolean) => emit('update:visible', value)
})

const tab = ref<'notify' | 'system' | 'review'>('notify')

/** 每次打开 +1，让各个列表都重新拉一次 */
const refreshToken = ref(0)

/** 通知条数（全部 / 系统类）：页签标题上的数字用总数，不是未读数 */
const counts = ref({ all: 0, system: 0, unread: 0 })

const pendingCount = computed(() => (props.commentCount ?? 0) + (props.recordCount ?? 0))

const notifyLabel = computed(() => `通知 ${counts.value.all}`)
const systemLabel = computed(() => `系统 ${counts.value.system}`)
const reviewLabel = computed(() => `待审 ${pendingCount.value}`)

async function loadCounts(): Promise<void> {
  const result = await notificationCounts()
  if (result.ok) counts.value = result.data
}

/** 列表里读 / 删之后：重拉计数 + 让顶栏角标重算 */
function onChanged(): void {
  void loadCounts()
  emit('changed')
}

watch(
  () => props.visible,
  (visible) => {
    if (!visible) return
    refreshToken.value += 1
    void loadCounts()
    // 管理员有东西要审就先停在待审页；否则看通知
    tab.value = auth.isAdmin && pendingCount.value > 0 ? 'review' : 'notify'
  }
)

/**
 * 换账号时如果还停在「待审」页，而新账号不是管理员，那个页签会被 v-if 摘掉 ——
 * 结果就是对话框里一片空白（tab 指向一个不存在的面板）。这里兜一下。
 */
watch(
  () => auth.isAdmin,
  (isAdmin) => {
    if (!isAdmin && tab.value === 'review') tab.value = 'notify'
  }
)
</script>

<template>
  <el-dialog v-model="dialogVisible" title="通知中心" width="46rem" top="8vh" append-to-body>
    <el-tabs v-model="tab">
      <el-tab-pane :label="notifyLabel" name="notify">
        <NotificationList
          scope="all"
          :refresh-token="refreshToken"
          @changed="onChanged"
          @leave="dialogVisible = false"
        />
      </el-tab-pane>

      <el-tab-pane :label="systemLabel" name="system">
        <NotificationList
          scope="system"
          :refresh-token="refreshToken"
          @changed="onChanged"
          @leave="dialogVisible = false"
        />
      </el-tab-pane>

      <el-tab-pane v-if="auth.isAdmin" :label="reviewLabel" name="review">
        <ReviewQueue
          :refresh-token="refreshToken"
          :comment-count="commentCount"
          :record-count="recordCount"
          @changed="emit('changed')"
          @leave="dialogVisible = false"
        />
      </el-tab-pane>
    </el-tabs>

    <template #footer>
      <span class="center__hint">
        待审里的「查看详情」会打开完整内容（含图片）；完整历史见「更多 → 通知」
      </span>
    </template>
  </el-dialog>
</template>

<style scoped>
.center__hint {
  font-size: var(--font-size-sm);
  color: var(--text-3);
}
</style>
