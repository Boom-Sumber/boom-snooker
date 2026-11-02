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
import { computed, ref } from 'vue'
import { useRouter } from 'vue-router'
import { ElImageViewer, ElMessage, ElMessageBox } from 'element-plus'
import { ArrowLeftBold } from '@element-plus/icons-vue'
import AdvancedFormDialog from '@renderer/components/AdvancedFormDialog.vue'
import CommentSection from '@renderer/components/CommentSection.vue'
import { CATEGORY_LABELS } from '@renderer/navigation/menu'
import { useAuthStore, useDatasetStore } from '@renderer/stores'
import { imageUrl } from '@shared/media/url'
import { deleteAdvanced } from '@shared/api/advanced'
import AuthorTag from '@renderer/components/AuthorTag.vue'

const props = defineProps<{ category: string; id: string }>()

const router = useRouter()
const dataset = useDatasetStore()
const auth = useAuthStore()

const categoryName = computed(
  () => CATEGORY_LABELS[props.category] ?? dataset.dictName('category', props.category)
)

const item = computed(() => dataset.findAdvanced(props.id))

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

      <div v-if="canManage" class="detail__actions">
        <el-button @click="formVisible = true">编辑</el-button>
        <el-button type="danger" plain @click="onDelete">删除</el-button>
      </div>
    </header>

    <div v-if="!dataset.isReady" class="state">
      <el-skeleton :rows="5" animated />
      <p class="state__text">数据还没同步完成，稍等一下…</p>
    </div>

    <el-empty v-else-if="!item" description="这条记录不存在，或已被作者删除">
      <el-button type="primary" @click="goBack">返回列表</el-button>
    </el-empty>

    <article v-else class="detail__body card">
      <h1 class="detail__title">{{ item.title }}</h1>
      <p class="detail__meta">
        <span>作者：<AuthorTag :name="item.updated_by" :deleted="item.author_deleted" /></span>
        <span>更新时间：{{ updatedText }}</span>
      </p>

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
      v-if="dataset.isReady && item"
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
