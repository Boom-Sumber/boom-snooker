<script setup lang="ts">
/**
 * 我的投稿（T4.12）
 *
 * 为什么单独一页：待审 / 驳回的记录**不在快照里**，列表页看不到它们，
 * 作者发完就只能等 —— 不知道自己的东西在哪、被谁驳了。
 *
 * 这里把「待审核 / 已通过 / 未通过」三种状态都列出来，点进去能看全文和图片：
 *   · 待审核：只能看和删，不能改（服务端 PENDING_LOCKED）
 *   · 未通过：能看驳回原因 + 审核人，改完保存会自动重新提交审核
 */
import { computed, onMounted, ref } from 'vue'
import { useRouter } from 'vue-router'
import { useAuthStore, useDatasetStore } from '@renderer/stores'
import { listMyRecords, type MyRecordItem, type ReviewStatus } from '@shared/api/myRecords'
import ReviewStamp from '@renderer/components/ReviewStamp.vue'

const router = useRouter()
const auth = useAuthStore()
const dataset = useDatasetStore()

const items = ref<MyRecordItem[]>([])
const loading = ref(false)
const errorText = ref('')

const STATUS_LABELS: Record<ReviewStatus, string> = {
  pending: '待审核',
  visible: '已通过',
  rejected: '未通过'
}

const STATUS_TAG_TYPE: Record<ReviewStatus, 'warning' | 'success' | 'info'> = {
  pending: 'warning',
  visible: 'success',
  rejected: 'info'
}

/** 「黄球 · 右上袋 · 满力 · 直线」/「翻袋系列 · 标题」 */
function recordTitle(item: MyRecordItem): string {
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

function formatTime(raw: string): string {
  const date = new Date(raw)
  if (Number.isNaN(date.getTime())) return raw
  const pad = (n: number): string => String(n).padStart(2, '0')
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())} ${pad(date.getHours())}:${pad(date.getMinutes())}`
}

function open(item: MyRecordItem): void {
  // 带上来源：详情页据此把左上角改成「返回我的投稿」
  const query = { from: 'my-submissions' }
  if (item.record_type === 'ball') {
    void router.push({ path: `/balls/${item.color_code}/${item.id}`, query })
  } else {
    void router.push({ path: `/advanced/${item.category_code}/${item.id}`, query })
  }
}

const summary = computed(() => {
  const count = (status: ReviewStatus): number =>
    items.value.filter((i) => i.review_status === status).length
  return { pending: count('pending'), visible: count('visible'), rejected: count('rejected') }
})

async function load(): Promise<void> {
  if (!auth.isSignedIn) {
    items.value = []
    return
  }

  loading.value = true
  errorText.value = ''

  const result = await listMyRecords()
  loading.value = false

  if (!result.ok) {
    errorText.value = result.message
    items.value = []
    return
  }
  items.value = result.data
}

onMounted(load)
</script>

<template>
  <section class="mine">
    <header class="mine__head">
      <div>
        <h1 class="mine__title">我的投稿</h1>
        <p class="mine__hint">
          待审核 <b>{{ summary.pending }}</b> · 已通过 <b>{{ summary.visible }}</b> · 未通过
          <b>{{ summary.rejected }}</b>
        </p>
      </div>
    </header>

    <div v-if="!auth.isSignedIn" class="mine__body card">
      <el-empty description="登录后查看自己的投稿" :image-size="80" />
    </div>

    <div v-else class="mine__body card">
      <p v-if="errorText" class="mine__error">
        {{ errorText }}
        <el-button text type="primary" size="small" @click="load">重试</el-button>
      </p>

      <el-skeleton v-else-if="loading" :rows="4" animated />

      <el-empty v-else-if="items.length === 0" description="还没有投过稿" :image-size="80" />

      <ul v-else class="mine__list">
        <li v-for="item in items" :key="item.id" class="sub">
          <button class="sub__main" type="button" @click="open(item)">
            <span class="sub__content">
              <span class="sub__head">
                <span class="sub__type">{{ item.record_type === 'ball' ? '彩球' : '进阶' }}</span>
                <span class="sub__title">{{ recordTitle(item) }}</span>
              </span>

              <span v-if="item.review_status === 'rejected' && item.review_note" class="sub__note">
                驳回原因：{{ item.review_note }}
              </span>

              <span class="sub__meta">
                <ReviewStamp
                  v-if="item.review_status !== 'pending' && item.reviewed_at"
                  :name="item.reviewer_name"
                  :role="item.reviewer_role"
                  :at="item.reviewed_at"
                  :status="item.review_status === 'rejected' ? 'rejected' : 'visible'"
                />
                <span class="sub__time">更新于 {{ formatTime(item.updated_at) }}</span>
              </span>
            </span>

            <!-- 状态标签放在卡片右侧并垂直居中 -->
            <el-tag
              class="sub__status"
              size="small"
              :type="STATUS_TAG_TYPE[item.review_status]"
              effect="plain"
            >
              {{ STATUS_LABELS[item.review_status] }}
            </el-tag>
          </button>
        </li>
      </ul>
    </div>
  </section>
</template>

<style scoped>
.mine {
  display: flex;
  flex-direction: column;
  gap: 0.875rem;
  padding: clamp(16px, 2.2vw, 28px);
}

.mine__title {
  margin: 0;
  font-size: clamp(1.25rem, 1.6vw, 1.5rem);
  font-weight: 500;
  color: var(--text-1);
}

.mine__hint {
  margin: 0.375rem 0 0;
  font-size: var(--font-size-sm);
  color: var(--text-3);
}

.mine__body {
  padding: clamp(1rem, 1.6vw, 1.5rem);
}

.mine__error {
  display: flex;
  gap: 0.5rem;
  align-items: center;
  margin: 0;
  font-size: var(--font-size-sm);
  color: var(--text-2);
}

.mine__list {
  display: flex;
  flex-direction: column;
  gap: 0.625rem;
  padding: 0;
  margin: 0;
  list-style: none;
}

.sub {
  background: var(--surface-2);
  border: 1px solid var(--border);
  border-radius: var(--radius-md);
}

.sub__main {
  display: flex;
  gap: 0.75rem;
  align-items: center;
  justify-content: space-between;
  width: 100%;
  padding: 0.75rem 0.875rem;
  text-align: left;
  cursor: pointer;
  background: transparent;
  border: 0;
}

.sub__content {
  display: flex;
  flex: 1;
  flex-direction: column;
  gap: 0.375rem;
  min-width: 0;
}

/* 状态标签：靠右、垂直居中，不随内容行高漂移 */
.sub__status {
  flex: none;
  align-self: center;
}

.sub__head {
  display: flex;
  flex-wrap: wrap;
  gap: 0.5rem;
  align-items: center;
}

.sub__type {
  flex: none;
  padding: 0 0.375rem;
  font-size: var(--font-size-sm);
  line-height: 1.6;
  color: var(--text-2);
  background: var(--surface);
  border: 1px solid var(--border);
  border-radius: 999px;
}

.sub__title {
  flex: 1;
  min-width: 0;
  font-size: 0.9375rem;
  color: var(--text-1);
  overflow-wrap: anywhere;
}

.sub__note {
  font-size: var(--font-size-sm);
  color: var(--text-2);
}

.sub__meta {
  display: flex;
  flex-wrap: wrap;
  gap: 0.5rem 0.875rem;
  align-items: center;
}

.sub__time {
  font-size: var(--font-size-sm);
  color: var(--text-3);
}
</style>
