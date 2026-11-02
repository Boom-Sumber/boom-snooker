<script setup lang="ts">
/**
 * 通知页（T4.9）
 *
 * 「更多 → 通知」的独立页面：看**完整历史**（含已读），可筛选、可删除、可清空已读。
 * 弹窗（通知中心）只做"最近要看的"，这里做"翻旧账"。
 *
 * 超管额外能在这里**发布系统通知**：一次 fan-out 给所有未停用账号，
 * 走 `publish_system_notice`（服务端校验超管 + 写审计）。
 */
import { computed, ref } from 'vue'
import { ElMessage } from 'element-plus'
import NotificationList from '@renderer/components/NotificationList.vue'
import { useAuthStore } from '@renderer/stores'
import { publishSystemNotice } from '@shared/api/notifications'
import type { NotificationScope } from '@shared/api/notifications'

const auth = useAuthStore()

/** 刷新令牌：发布系统通知后让列表重拉 */
const refreshToken = ref(0)

const SCOPE_TABS: { value: NotificationScope; label: string }[] = [
  { value: 'all', label: '全部' },
  { value: 'review', label: '审核结果' },
  { value: 'system', label: '系统通知' }
]
const scope = ref<NotificationScope>('all')

const publishVisible = ref(false)
const publishing = ref(false)
const form = ref({ title: '', body: '' })

const canPublish = computed(
  () => auth.isSuperadmin && form.value.title.trim().length > 0 && !publishing.value
)

function openPublish(): void {
  form.value = { title: '', body: '' }
  publishVisible.value = true
}

async function submitPublish(): Promise<void> {
  if (!canPublish.value) return
  publishing.value = true

  const result = await publishSystemNotice(form.value.title, form.value.body)
  publishing.value = false

  if (!result.ok) {
    ElMessage.error(result.message)
    return
  }

  publishVisible.value = false
  onChanged()
  ElMessage.success(`已发送给 ${result.data} 个账号`)
}

/**
 * 列表里读 / 删之后：重拉列表 + 让顶栏角标重算
 *
 * 顶栏在另一个组件里，`refreshToken` 只影响本页列表，
 * 所以这里同时派发全局事件（TopBar 监听 `snooker:review-changed`）。
 */
function onChanged(): void {
  refreshToken.value += 1
  window.dispatchEvent(new Event('snooker:review-changed'))
}
</script>

<template>
  <section class="notices">
    <header class="notices__head">
      <div>
        <h1 class="notices__title">通知</h1>
        <p class="notices__hint">审核结果与系统通知都在这里；未读会显示在顶部铃铛的角标上</p>
      </div>

      <el-button v-if="auth.isSuperadmin" type="primary" @click="openPublish">
        发布系统通知
      </el-button>
    </header>

    <div class="notices__body card">
      <!-- 只渲染当前筛选的一份列表：三个页签各挂一个实例会重复请求三次 -->
      <el-tabs v-model="scope">
        <el-tab-pane
          v-for="item in SCOPE_TABS"
          :key="item.value"
          :label="item.label"
          :name="item.value"
        />
      </el-tabs>

      <NotificationList
        :scope="scope"
        :refresh-token="refreshToken"
        :page-size="20"
        show-clear-read
        @changed="onChanged"
      />
    </div>

    <!-- 发布系统通知（仅超管） -->
    <el-dialog v-model="publishVisible" title="发布系统通知" width="32rem" append-to-body>
      <el-form label-position="top">
        <el-form-item label="标题（必填，最多 60 字）">
          <el-input
            v-model="form.title"
            maxlength="60"
            show-word-limit
            placeholder="比如：本周六晚数据维护"
          />
        </el-form-item>
        <el-form-item label="正文（可选，最多 500 字）">
          <el-input
            v-model="form.body"
            type="textarea"
            :rows="4"
            maxlength="500"
            show-word-limit
            placeholder="说明一下影响范围和时间"
          />
        </el-form-item>
      </el-form>

      <p class="publish__hint">会推送给所有在用账号（含你自己），在「通知 → 系统」里查看</p>

      <template #footer>
        <el-button @click="publishVisible = false">取消</el-button>
        <el-button
          type="primary"
          :disabled="!canPublish"
          :loading="publishing"
          @click="submitPublish"
        >
          发布
        </el-button>
      </template>
    </el-dialog>
  </section>
</template>

<style scoped>
.notices {
  display: flex;
  flex-direction: column;
  gap: 0.875rem;
  padding: clamp(16px, 2.2vw, 28px);
}

.notices__head {
  display: flex;
  flex-wrap: wrap;
  gap: 0.75rem;
  align-items: flex-end;
  justify-content: space-between;
}

.notices__title {
  margin: 0;
  font-size: clamp(1.25rem, 1.6vw, 1.5rem);
  font-weight: 500;
  color: var(--text-1);
}

.notices__hint {
  margin: 0.375rem 0 0;
  font-size: var(--font-size-sm);
  color: var(--text-3);
}

.notices__body {
  padding: clamp(1rem, 1.6vw, 1.5rem);
}

.publish__hint {
  margin: 0;
  font-size: var(--font-size-sm);
  color: var(--text-3);
}
</style>
