<script setup lang="ts">
/**
 * 彩球打法卡片（列表页用）
 *
 * 与进阶卡片同一套模式：列表只做索引 —— **预览图 + 力度 + 进袋方式 + 作者/日期**，
 * 点整张卡片进详情页看完整内容（方法 / 走位补偿 / 补充说明 / 三张图）。
 *
 * 预览图优先用击球点图（最能代表这条打法），没有就退到蓝点图、路线图。
 * 右上角 `···`（编辑/删除）是卡片内唯一的交互区，`@click.stop` 防止误跳转。
 */
import { computed } from 'vue'
import { imageUrl } from '@shared/media/url'
import type { Ball } from '@renderer/stores'

const props = defineProps<{
  ball: Ball
  /** 力度中文（满力 / 半力），由父组件从字典取，卡片不自己查字典 */
  strengthText: string
}>()

const emit = defineEmits<{ (event: 'open'): void }>()

const preview = computed(() => {
  const { impact_image: impact, blue_image: blue, route_image: route } = props.ball
  return imageUrl(impact) || imageUrl(blue) || imageUrl(route)
})

const updatedText = computed(() => {
  const raw = props.ball.updated_at
  if (!raw) return ''
  const date = new Date(raw)
  if (Number.isNaN(date.getTime())) return raw
  const pad = (n: number): string => String(n).padStart(2, '0')
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())} ${pad(date.getHours())}:${pad(date.getMinutes())}`
})
</script>

<template>
  <article
    class="ball-card card"
    role="link"
    tabindex="0"
    :aria-label="`查看 ${strengthText} ${ball.method}`"
    @click="emit('open')"
    @keydown.enter="emit('open')"
    @keydown.space.prevent="emit('open')"
  >
    <div class="ball-card__actions" @click.stop>
      <slot name="actions" />
    </div>

    <div class="ball-card__media">
      <img v-if="preview" :src="preview" alt="击球点示意图" loading="lazy" />
      <span v-else class="ball-card__empty">无图片</span>
    </div>

    <div class="ball-card__head">
      <span class="ball-card__strength">{{ strengthText }}</span>
      <span class="ball-card__method">{{ ball.method }}</span>
    </div>

    <p class="ball-card__meta">
      <span>{{ ball.updated_by || '未知' }}</span>
      <span>{{ updatedText }}</span>
    </p>
  </article>
</template>

<style scoped>
.ball-card {
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

.ball-card:hover,
.ball-card:focus-visible {
  outline: none;
  box-shadow: var(--shadow-2);
  transform: translateY(-2px);
}

.ball-card__actions {
  position: absolute;
  top: 0.375rem;
  right: 0.375rem;
  z-index: 1;
  /* 半透明衬底，避免图片把按钮吃掉 */
  background: color-mix(in srgb, var(--surface) 82%, transparent);
  border-radius: var(--radius-sm);
}

.ball-card__media {
  display: grid;
  place-items: center;
  width: 100%;
  height: 9rem;
  overflow: hidden;
  /* 与进阶卡片一致：不加白底 */
  background: transparent;
  border: 1px solid var(--border);
  border-radius: var(--radius-md);
}

.ball-card__media img {
  width: 100%;
  height: 100%;
  object-fit: contain;
}

.ball-card__empty {
  font-size: var(--font-size-sm);
  color: var(--text-3);
}

.ball-card__head {
  display: flex;
  gap: 0.625rem;
  align-items: baseline;
  min-width: 0;
}

/* 力度保留旧版的视觉锚点（大字 + 主题色） */
.ball-card__strength {
  flex: none;
  font-size: 1.375rem;
  font-weight: 600;
  line-height: 1.2;
  color: var(--primary);
}

.ball-card__method {
  overflow: hidden;
  font-size: 0.9375rem;
  color: var(--text-1);
  white-space: nowrap;
  text-overflow: ellipsis;
}

.ball-card__meta {
  display: flex;
  flex-wrap: wrap;
  gap: 0.25rem 0.75rem;
  margin: 0;
  font-size: var(--font-size-sm);
  color: var(--text-2);
}
</style>
