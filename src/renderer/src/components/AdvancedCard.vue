<script setup lang="ts">
/**
 * 进阶条目卡片
 *
 * 字段顺序照旧版 WPF `AdvancedView.xaml`：标题 → 作者/更新时间 → 图 → 描述 → 注解。
 * 旧版是 CoverView（封面点开才看正文），这里直接平铺，少一次点击；
 * 图仍然可以点开看大图。
 */
import { computed, ref } from 'vue'
import { ElImageViewer } from 'element-plus'
import { imageUrl } from '@shared/media/url'
import type { Advanced } from '@renderer/stores'

const props = defineProps<{ item: Advanced }>()

const image = computed(() => imageUrl(props.item.image))

const viewerVisible = ref(false)

const updatedText = computed(() => {
  const raw = props.item.updated_at
  if (!raw) return ''
  const date = new Date(raw)
  if (Number.isNaN(date.getTime())) return raw
  const pad = (n: number): string => String(n).padStart(2, '0')
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())} ${pad(date.getHours())}:${pad(date.getMinutes())}`
})
</script>

<template>
  <article class="advanced-card card">
    <header class="advanced-card__head">
      <h2 class="advanced-card__title">{{ item.title }}</h2>
      <div class="advanced-card__actions">
        <slot name="actions" />
      </div>
    </header>

    <p class="advanced-card__meta">
      <span>作者：{{ item.updated_by || '未知' }}</span>
      <span>更新时间：{{ updatedText }}</span>
    </p>

    <button
      class="advanced-card__media"
      type="button"
      :title="image ? '查看大图' : '暂无图片'"
      :disabled="!image"
      @click="viewerVisible = true"
    >
      <img v-if="image" :src="image" :alt="item.title" loading="lazy" />
      <span v-else class="advanced-card__empty">无图片</span>
    </button>

    <dl class="advanced-card__fields">
      <div class="field">
        <dt>描述：</dt>
        <dd>{{ item.description || '—' }}</dd>
      </div>
      <div class="field">
        <dt>注解：</dt>
        <dd>{{ item.content || '—' }}</dd>
      </div>
    </dl>

    <ElImageViewer
      v-if="viewerVisible && image"
      :url-list="[image]"
      teleported
      @close="viewerVisible = false"
    />
  </article>
</template>

<style scoped>
.advanced-card {
  display: flex;
  flex-direction: column;
  gap: 0.625rem;
  padding: 1rem 1.125rem 1.125rem;
}

.advanced-card__head {
  display: flex;
  gap: 0.75rem;
  align-items: flex-start;
  justify-content: space-between;
}

.advanced-card__title {
  margin: 0;
  font-size: 1.0625rem;
  font-weight: 500;
  line-height: 1.4;
  color: var(--text-1);
  overflow-wrap: anywhere;
}

.advanced-card__actions {
  flex: none;
}

.advanced-card__meta {
  display: flex;
  flex-wrap: wrap;
  gap: 0.25rem 1.25rem;
  margin: 0;
  font-size: var(--font-size-sm);
  color: var(--text-2);
}

.advanced-card__media {
  display: grid;
  place-items: center;
  width: 100%;
  /* 图多是 150×150 或 16:9，固定高度 + contain，不裁切 */
  height: 13rem;
  padding: 0.5rem;
  overflow: hidden;
  cursor: zoom-in;
  background: var(--image-frame-bg);
  border: 1px solid var(--border);
  border-radius: var(--radius-md);
  transition: box-shadow var(--transition-fast);
}

.advanced-card__media:disabled {
  cursor: default;
}

.advanced-card__media:not(:disabled):hover {
  box-shadow: var(--shadow-2);
}

.advanced-card__media img {
  width: 100%;
  height: 100%;
  object-fit: contain;
}

.advanced-card__empty {
  font-size: var(--font-size-sm);
  color: var(--text-3);
}

.advanced-card__fields {
  display: flex;
  flex-direction: column;
  gap: 0.375rem;
  margin: 0;
}

.field {
  display: grid;
  grid-template-columns: 4rem 1fr;
  gap: 0.25rem;
  font-size: 0.9375rem;
  line-height: 1.7;
}

.field dt {
  font-weight: 600;
  color: var(--text-1);
}

.field dd {
  margin: 0;
  color: var(--text-2);
  /* 注解可能有换行，保留排版 */
  white-space: pre-wrap;
  overflow-wrap: anywhere;
}
</style>
