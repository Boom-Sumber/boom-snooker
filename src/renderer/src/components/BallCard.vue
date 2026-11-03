<script setup lang="ts">
/**
 * 彩球打法卡片（列表页用）
 *
 * 字段顺序照旧版 WPF（docs/04 §5.4）：力度大字 → 作者/更新时间 →
 * 方法 → 走位补偿（低杆/高杆）→ 补充说明 → 三张图。
 *
 * 三条版式约定（用户要求）：
 *   1. **卡片高度固定**（`height: 25rem`）—— 一屏能对齐，滚动时不会参差不齐
 *   2. **图片区占位固定**：三个 5.25rem 方框，没图也占位（显示「无图」），不塌陷
 *   3. **文字超长一律省略号**：每个字段按行数截断（`-webkit-line-clamp`），
 *      不换行撑高卡片；完整内容去详情页看
 *
 * 点整张卡片进详情页；右上 `···`（编辑/删除）是卡片内唯一的交互区，要 `.stop`。
 */
import { computed } from 'vue'
import { imageUrl } from '@shared/media/url'
import type { Ball } from '@renderer/stores'
import AuthorTag from '@renderer/components/AuthorTag.vue'
import LazyImage from '@renderer/components/LazyImage.vue'

const props = defineProps<{
  ball: Ball
  /** 力度中文（满力 / 半力），由父组件从字典取，卡片不自己查字典 */
  strengthText: string
}>()

const emit = defineEmits<{ (event: 'open'): void }>()

/** 三个图片位固定顺序，空值也占位（避免有图/无图的卡片高度不一致） */
const images = computed(() => [
  { kind: 'impact', label: '击球点', url: imageUrl(props.ball.impact_image) },
  { kind: 'blue', label: '蓝点', url: imageUrl(props.ball.blue_image) },
  { kind: 'route', label: '路线图', url: imageUrl(props.ball.route_image) }
])

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
    <header class="ball-card__head">
      <div class="ball-card__strength">{{ strengthText }}</div>
      <div class="ball-card__meta">
        <span>作者：<AuthorTag :name="ball.updated_by" :deleted="ball.author_deleted" /></span>
        <span>更新时间：{{ updatedText }}</span>
      </div>
      <div class="ball-card__actions" @click.stop>
        <slot name="actions" />
      </div>
    </header>

    <dl class="ball-card__fields">
      <div class="field field--sight">
        <dt>方法：</dt>
        <dd>{{ ball.sight || '—' }}</dd>
      </div>

      <div class="field field--group">
        <dt>走位补偿：</dt>
        <dd>
          <p><span class="field__sub">低杆走位：</span>{{ ball.low_comp || '—' }}</p>
          <p><span class="field__sub">高杆走位：</span>{{ ball.high_comp || '—' }}</p>
        </dd>
      </div>

      <div class="field field--remark">
        <dt>补充说明：</dt>
        <dd>{{ ball.remark || '—' }}</dd>
      </div>
    </dl>

    <div class="ball-card__media">
      <div
        v-for="item in images"
        :key="item.kind"
        class="thumb"
        :class="{ 'thumb--empty': !item.url }"
        :title="item.label"
      >
        <LazyImage v-if="item.url" :src="item.url" :alt="item.label" />
        <span v-else class="thumb__empty">{{ item.label }}无图</span>
      </div>
    </div>
  </article>
</template>

<style scoped>
.ball-card {
  /* 固定高度：卡片内文字按行截断，图片区固定占位，一屏排列才整齐 */
  display: flex;
  flex-direction: column;
  gap: 0.75rem;
  height: 25rem;
  padding: 1rem 1.125rem 1.125rem;
  overflow: hidden;
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

.ball-card__head {
  display: grid;
  flex: none;
  grid-template-columns: auto 1fr auto;
  gap: 0.75rem;
  align-items: end;
}

.ball-card__strength {
  font-size: 1.75rem; /* 旧版 30px 大字，是卡片的视觉锚点 */
  font-weight: 600;
  line-height: 1.1;
  color: var(--primary);
  letter-spacing: 0.02em;
}

.ball-card__meta {
  display: flex;
  flex-wrap: wrap;
  gap: 0.25rem 1.25rem;
  font-size: var(--font-size-sm);
  color: var(--text-2);
}

.ball-card__actions {
  align-self: start;
}

/* 字段区吃掉剩余高度；超出的部分裁掉（每个字段自己按行数截断） */
.ball-card__fields {
  display: flex;
  flex: 1;
  flex-direction: column;
  gap: 0.5rem;
  min-height: 0;
  margin: 0;
  overflow: hidden;
}

.field {
  display: grid;
  grid-template-columns: 5.5rem 1fr;
  gap: 0.25rem;
  font-size: 0.9375rem;
  line-height: 1.75;
}

.field dt {
  font-weight: 600;
  color: var(--text-1);
}

.field dd {
  margin: 0;
  overflow: hidden;
  color: var(--text-2);
  overflow-wrap: anywhere;
  /* 多行省略：超出按行数截断，行尾出省略号 */
  display: -webkit-box;
  -webkit-box-orient: vertical;
}

.field--sight dd {
  -webkit-line-clamp: 2;
}

.field--group dd {
  -webkit-line-clamp: 2;
}

.field--remark dd {
  -webkit-line-clamp: 2;
}

.field dd p {
  margin: 0;
  overflow: hidden;
  white-space: nowrap;
  text-overflow: ellipsis;
}

.field__sub {
  color: var(--text-1);
}

/* 图片区：三个固定方框，有图无图都占同样大小 */
.ball-card__media {
  display: flex;
  flex: none;
  gap: 0.75rem;
  align-items: center;
  padding-top: 0.75rem;
  border-top: 1px solid var(--border);
}

.thumb {
  display: grid;
  flex: none;
  place-items: center;
  width: 5.25rem;
  height: 5.25rem;
  padding: 0.25rem;
  overflow: hidden;
  /* 与详情页一致：不加白底，只留一圈边框把占位画出来 */
  background: transparent;
  border: 1px solid var(--border);
  border-radius: var(--radius-md);
}

.thumb--empty {
  border-style: dashed;
}

.thumb__empty {
  font-size: 0.75rem;
  color: var(--text-3);
  text-align: center;
}
</style>
