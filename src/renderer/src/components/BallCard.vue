<script setup lang="ts">
/**
 * 彩球打法卡片
 *
 * 字段顺序照旧版 WPF（docs/04 §5.4）：力度大字 → 作者/更新时间 →
 * 方法（瞄准）→ 走位补偿（低杆/高杆）→ 补充说明 → 三张图。
 *
 * 图片：击球点 / 蓝点在卡片里直接显示（150px 白底衬），
 * 路线图只在「查看路线图」里看大图 —— 点任意一张图也能在查看器里左右翻。
 */
import { computed, ref } from 'vue'
import { ElImageViewer } from 'element-plus'
import { imageUrl } from '@shared/media/url'
import type { Ball } from '@renderer/stores'

const props = defineProps<{
  ball: Ball
  /** 力度中文（满力 / 半力），由父组件从字典取，卡片不自己查字典 */
  strengthText: string
}>()

/**
 * 三张图按「击球点 → 蓝点 → 路线」排列，查看器里就是这个顺序。
 *
 * 注意：**不能直接按下标 0/1/2 去开查看器** —— 库里确实有图片字段为空的行
 * （测试数据 `（正在测试）` 那几条），空值被过滤后下标会错位。
 * 所以先建 media 列表，开查看器时按 kind 反查下标。
 */
type MediaKind = 'impact' | 'blue' | 'route'

const media = computed(() =>
  (
    [
      { kind: 'impact' as const, url: imageUrl(props.ball.impact_image) },
      { kind: 'blue' as const, url: imageUrl(props.ball.blue_image) },
      { kind: 'route' as const, url: imageUrl(props.ball.route_image) }
    ] satisfies { kind: MediaKind; url: string }[]
  ).filter((item) => item.url.length > 0)
)

const previewList = computed(() => media.value.map((item) => item.url))

const impactUrl = computed(() => media.value.find((item) => item.kind === 'impact')?.url ?? '')
const blueUrl = computed(() => media.value.find((item) => item.kind === 'blue')?.url ?? '')
const hasRoute = computed(() => media.value.some((item) => item.kind === 'route'))

const viewerVisible = ref(false)
const viewerIndex = ref(0)

function openViewer(kind: MediaKind): void {
  const index = media.value.findIndex((item) => item.kind === kind)
  if (index < 0) return
  viewerIndex.value = index
  viewerVisible.value = true
}

/** 更新时间只显示到分钟，旧版带秒但列表里没人看秒 */
const updatedText = computed(() => {
  const raw = props.ball.updated_at
  if (!raw) return ''
  const date = new Date(raw)
  if (Number.isNaN(date.getTime())) return raw
  const pad = (n: number): string => String(n).padStart(2, '0')
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())} ${pad(date.getHours())}:${pad(date.getMinutes())}`
})

const authorText = computed(() => props.ball.updated_by || '未知')
</script>

<template>
  <article class="ball-card card">
    <header class="ball-card__head">
      <div class="ball-card__strength">{{ strengthText }}</div>
      <div class="ball-card__meta">
        <span>作者：{{ authorText }}</span>
        <span>更新时间：{{ updatedText }}</span>
      </div>
      <!-- T3.3 的表单会把编辑/删除放进这个槽 -->
      <div class="ball-card__actions">
        <slot name="actions" />
      </div>
    </header>

    <dl class="ball-card__fields">
      <div class="field">
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

      <div class="field">
        <dt>补充说明：</dt>
        <dd>{{ ball.remark || '—' }}</dd>
      </div>
    </dl>

    <div class="ball-card__media">
      <button class="thumb" type="button" title="查看大图" @click="openViewer('impact')">
        <img v-if="impactUrl" :src="impactUrl" alt="击球点示意图" loading="lazy" />
        <span v-else class="thumb__empty">无击球点图</span>
      </button>
      <button class="thumb" type="button" title="查看大图" @click="openViewer('blue')">
        <img v-if="blueUrl" :src="blueUrl" alt="蓝点示意图" loading="lazy" />
        <span v-else class="thumb__empty">无蓝点图</span>
      </button>

      <div class="media__side">
        <p class="media__caption">蓝点、击球点示意图</p>
        <el-button size="small" :disabled="!hasRoute" @click="openViewer('route')">
          {{ hasRoute ? '查看路线图' : '暂无路线图' }}
        </el-button>
      </div>
    </div>

    <ElImageViewer
      v-if="viewerVisible"
      :url-list="previewList"
      :initial-index="viewerIndex"
      teleported
      @close="viewerVisible = false"
    />
  </article>
</template>

<style scoped>
.ball-card {
  display: flex;
  flex-direction: column;
  gap: 0.75rem;
  padding: 1rem 1.125rem 1.125rem;
}

.ball-card__head {
  display: grid;
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

.ball-card__fields {
  display: flex;
  flex-direction: column;
  gap: 0.5rem;
  margin: 0;
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
  color: var(--text-2);
  /* 走位说明可能几百字：保留换行 + 长串可断行，不撑破卡片 */
  white-space: pre-wrap;
  overflow-wrap: anywhere;
}

.field dd p {
  margin: 0;
}

.field__sub {
  color: var(--text-1);
}

.ball-card__media {
  display: flex;
  flex-wrap: wrap;
  gap: 0.75rem;
  align-items: center;
  padding-top: 0.25rem;
  border-top: 1px solid var(--border);
}

.thumb {
  display: grid;
  place-items: center;
  width: 7.5rem; /* 旧版 150px */
  height: 7.5rem;
  padding: 0.25rem;
  overflow: hidden;
  cursor: zoom-in;
  /* 路线图/击球点图是白底或透明底 PNG，暗色卡片上必须衬白底 */
  background: var(--image-frame-bg);
  border: 1px solid var(--border);
  border-radius: var(--radius-md);
  transition: box-shadow var(--transition-fast);
}

.thumb:hover {
  box-shadow: var(--shadow-2);
}

.thumb img {
  width: 100%;
  height: 100%;
  object-fit: contain;
}

.thumb__empty {
  font-size: var(--font-size-sm);
  color: var(--text-3);
}

.media__side {
  display: flex;
  flex-direction: column;
  gap: 0.5rem;
  align-items: flex-start;
}

.media__caption {
  margin: 0;
  font-size: var(--font-size-sm);
  color: var(--text-2);
}
</style>
