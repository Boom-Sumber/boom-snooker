<script setup lang="ts">
/**
 * 懒加载图片（T5.2）
 *
 * 为什么不用原生 `loading="lazy"`：
 *   1. 阈值不可控 —— Chromium 自己的预取距离，列表滚快一点就会看到空白框；
 *   2. **没有占位** —— 原生懒加载在触发前不占尺寸，卡片会跳；
 *   3. 组件卸载/切页时无法主动取消，图片请求会继续跑。
 *
 * 这里用 `IntersectionObserver` + `rootMargin`（默认提前 240px）：
 * 进入预取范围才把 `src` 挂上去，加载完成前显示骨架，完成后淡入。
 * 图片本身走 `snooker-media://` 协议（T5.1），命中本地缓存时几乎瞬开。
 *
 * 两种排版模式：
 *   - `fill`（默认）：铺满父容器，父容器负责尺寸（卡片缩略图 / 150×150 方框）
 *   - `natural`：按图片原始比例，父容器用 `width: fit-content` 之类约束
 *
 * ⚠️ 图片是**装饰性内容**时父组件仍要传 `alt`（无障碍），别传空串凑数。
 */
import { onBeforeUnmount, onMounted, ref, watch } from 'vue'

const props = withDefaults(
  defineProps<{
    src: string
    alt: string
    /** fill：铺满父容器；natural：按原图比例 */
    mode?: 'fill' | 'natural'
    /** 对应 CSS `object-fit`，方框类缩略图要传 fill 才会拉伸填满 */
    fit?: 'contain' | 'fill' | 'cover'
    /** 可选的最大高度（如详情页路线图 45vh），只对 natural 模式有意义 */
    maxHeight?: string
    /** 提前多少像素开始加载 */
    rootMargin?: string
  }>(),
  { mode: 'fill', fit: 'contain', maxHeight: '', rootMargin: '240px 0px' }
)

const root = ref<HTMLElement | null>(null)
/** 是否进入预取范围（false 时连 `src` 都不挂，请求根本不会发出） */
const visible = ref(false)
const loaded = ref(false)
const failed = ref(false)

let observer: IntersectionObserver | null = null

function stopObserving(): void {
  observer?.disconnect()
  observer = null
}

function reveal(): void {
  visible.value = true
  stopObserving()
}

onMounted(() => {
  if (!props.src) {
    // 没图就没必要观察，父组件一般已经用 v-else 处理了空态
    visible.value = true
    return
  }
  if (typeof IntersectionObserver === 'undefined') {
    // 极端兜底：不支持就直接加载，不要留一片空白
    reveal()
    return
  }
  observer = new IntersectionObserver(
    (entries) => {
      if (entries.some((entry) => entry.isIntersecting)) reveal()
    },
    { rootMargin: props.rootMargin }
  )
  if (root.value) observer.observe(root.value)
})

// 换图（路由复用组件 / 表单重新选图）时重置状态，避免显示上一张
watch(
  () => props.src,
  (next) => {
    loaded.value = false
    failed.value = false
    if (!next) visible.value = true
  }
)

onBeforeUnmount(stopObserving)
</script>

<template>
  <span
    ref="root"
    class="lazy-image"
    :class="[`lazy-image--${mode}`, { 'is-loaded': loaded, 'is-failed': failed }]"
  >
    <!-- 骨架：加载完成前占位，避免卡片高度跳动 -->
    <span v-if="!loaded && !failed" class="lazy-image__skeleton" aria-hidden="true" />

    <img
      v-if="visible && src && !failed"
      :src="src"
      :alt="alt"
      :style="{ objectFit: fit, maxHeight: maxHeight || undefined }"
      decoding="async"
      @load="loaded = true"
      @error="failed = true"
    />

    <span v-else-if="failed" class="lazy-image__failed">图片加载失败</span>
  </span>
</template>

<style scoped>
.lazy-image {
  position: relative;
  display: block;
  overflow: hidden;
}

/* 铺满父容器：父容器决定尺寸（缩略图方框 / 卡片预览区） */
.lazy-image--fill {
  width: 100%;
  height: 100%;
}

.lazy-image--fill img {
  position: absolute;
  inset: 0;
  width: 100%;
  height: 100%;
}

/* 原始比例：父容器自己撑开（fit-content / inline-block） */
.lazy-image--natural {
  display: inline-block;
  max-width: 100%;
}

.lazy-image--natural img {
  display: block;
  max-width: 100%;
  height: auto;
  /* 加载完成前不占高度，由骨架撑住 */
}

.lazy-image__skeleton {
  display: block;
  width: 100%;
  height: 100%;
  min-height: 100%;
  background: linear-gradient(
    100deg,
    var(--skeleton-from, rgb(0 0 0 / 5%)) 30%,
    var(--skeleton-to, rgb(0 0 0 / 9%)) 50%,
    var(--skeleton-from, rgb(0 0 0 / 5%)) 70%
  );
  background-size: 300% 100%;
  animation: lazy-shimmer 1.4s ease-in-out infinite;
}

.lazy-image--natural .lazy-image__skeleton {
  width: 18rem;
  max-width: 100%;
  height: 8rem;
  min-height: 0;
  border-radius: var(--radius-sm);
}

.lazy-image.is-loaded img {
  animation: lazy-fade-in 0.18s ease-out;
}

.lazy-image__failed {
  display: grid;
  place-items: center;
  width: 100%;
  height: 100%;
  min-height: 2.5rem;
  font-size: var(--font-size-sm);
  color: var(--text-3);
}

@keyframes lazy-shimmer {
  from {
    background-position: 150% 0;
  }
  to {
    background-position: -150% 0;
  }
}

@keyframes lazy-fade-in {
  from {
    opacity: 0;
  }
  to {
    opacity: 1;
  }
}

/* 系统开了「减少动效」就别闪 */
@media (prefers-reduced-motion: reduce) {
  .lazy-image__skeleton {
    animation: none;
  }

  .lazy-image.is-loaded img {
    animation: none;
  }
}

:global(html.dark) .lazy-image {
  --skeleton-from: rgb(255 255 255 / 5%);
  --skeleton-to: rgb(255 255 255 / 10%);
}
</style>
