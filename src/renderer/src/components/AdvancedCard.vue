<script setup lang="ts">
/**
 * 进阶条目卡片（列表页用）
 *
 * 列表只负责"认路"：**预览图 + 标题 + 作者 + 日期**，点整张卡片进详情页看正文
 * （描述/注解/大图，以后评论区也放那边）。
 * 右上角的 `···`（编辑/删除）是卡片内唯一的交互区，点击要 `.stop`，不能触发跳转。
 */
import { computed } from 'vue'
import { imageUrl } from '@shared/media/url'
import type { Advanced } from '@renderer/stores'

const props = defineProps<{ item: Advanced }>()

const emit = defineEmits<{ (event: 'open'): void }>()

const image = computed(() => imageUrl(props.item.image))

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
  <article
    class="advanced-card card"
    role="link"
    tabindex="0"
    :aria-label="`查看 ${item.title}`"
    @click="emit('open')"
    @keydown.enter="emit('open')"
    @keydown.space.prevent="emit('open')"
  >
    <!-- 编辑/删除：卡片内唯一的可点区域，必须阻止冒泡 -->
    <div class="advanced-card__actions" @click.stop>
      <slot name="actions" />
    </div>

    <div class="advanced-card__media">
      <img v-if="image" :src="image" :alt="item.title" loading="lazy" />
      <span v-else class="advanced-card__empty">无图片</span>
    </div>

    <h2 class="advanced-card__title">{{ item.title }}</h2>

    <p class="advanced-card__meta">
      <span>{{ item.updated_by || '未知' }}</span>
      <span>{{ updatedText }}</span>
    </p>
  </article>
</template>

<style scoped>
.advanced-card {
  position: relative;
  display: flex;
  flex-direction: column;
  gap: 0.5rem;
  padding: 0.75rem 0.75rem 0.875rem;
  cursor: pointer;
  transition:
    box-shadow var(--transition-fast),
    transform var(--transition-fast);
}

.advanced-card:hover,
.advanced-card:focus-visible {
  outline: none;
  box-shadow: var(--shadow-2);
  transform: translateY(-2px);
}

.advanced-card__actions {
  position: absolute;
  top: 0.375rem;
  right: 0.375rem;
  z-index: 1;
  /* 半透明衬底，避免图片把按钮吃掉 */
  background: color-mix(in srgb, var(--surface) 82%, transparent);
  border-radius: var(--radius-sm);
}

.advanced-card__media {
  display: grid;
  place-items: center;
  width: 100%;
  /* 预览图统一高度，卡片高度整齐；contain 不裁切 */
  height: 9rem;
  overflow: hidden;
  /* 与详情页一致：不加白底，暗色主题下不留白块 */
  background: transparent;
  border: 1px solid var(--border);
  border-radius: var(--radius-md);
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

.advanced-card__title {
  margin: 0;
  /* 最多两行，超出省略：卡片只做索引，标题再长也不撑高 */
  display: -webkit-box;
  overflow: hidden;
  font-size: 1rem;
  font-weight: 500;
  line-height: 1.4;
  color: var(--text-1);
  overflow-wrap: anywhere;
  -webkit-box-orient: vertical;
  -webkit-line-clamp: 2;
}

.advanced-card__meta {
  display: flex;
  flex-wrap: wrap;
  gap: 0.25rem 0.75rem;
  margin: 0;
  font-size: var(--font-size-sm);
  color: var(--text-2);
}
</style>
