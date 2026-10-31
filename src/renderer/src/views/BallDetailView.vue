<script setup lang="ts">
/**
 * 彩球打法详情页
 *
 * 列表页的卡片已经带全部文字，这里补的是"看全 + 看大"：
 * 方法 / 低杆走位 / 高杆走位 / 补充说明，下面再放三张图。
 *
 * 图片区版式（用户指定）：
 *   - 放在文字内容**下面**
 *   - 两列：左列「击球点 / 蓝点」上下排列，**固定 150×150 拉伸显示**；
 *     右列「路线图」按预览尺寸显示
 *   - **只有路线图能点开原图**，击球点/蓝点只是静态缩略图
 *
 * 以后的评论区（阶段 4）挂在页面底部 —— 现在只留位置，不做设计。
 *
 * 数据不额外请求：按 id 从本地快照取（`dataset.findBall`），离线也能看。
 */
import { computed, ref } from 'vue'
import { useRouter } from 'vue-router'
import { ElImageViewer, ElMessage, ElMessageBox } from 'element-plus'
import { ArrowLeftBold } from '@element-plus/icons-vue'
import BallFormDialog from '@renderer/components/BallFormDialog.vue'
import { BALL_LABELS } from '@renderer/navigation/menu'
import { useAuthStore, useDatasetStore } from '@renderer/stores'
import { imageUrl } from '@shared/media/url'
import { deleteBall } from '@shared/api/balls'

const props = defineProps<{ color: string; id: string }>()

const router = useRouter()
const dataset = useDatasetStore()
const auth = useAuthStore()

const ball = computed(() => dataset.findBall(props.id))

const colorName = computed(() => BALL_LABELS[props.color] ?? dataset.dictName('color', props.color))

const strengthText = computed(() =>
  ball.value ? dataset.dictName('strength', ball.value.strength_code) : ''
)

const pocketText = computed(() =>
  ball.value ? dataset.dictName('pocket', ball.value.pocket_code) : ''
)

/** 三张图分开取：只有路线图会进查看器 */
const impactUrl = computed(() => imageUrl(ball.value?.impact_image ?? ''))
const blueUrl = computed(() => imageUrl(ball.value?.blue_image ?? ''))
const routeUrl = computed(() => imageUrl(ball.value?.route_image ?? ''))

const viewerVisible = ref(false)
const formVisible = ref(false)

const updatedText = computed(() => {
  const raw = ball.value?.updated_at
  if (!raw) return ''
  const date = new Date(raw)
  if (Number.isNaN(date.getTime())) return raw
  const pad = (n: number): string => String(n).padStart(2, '0')
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())} ${pad(date.getHours())}:${pad(date.getMinutes())}`
})

/** 只有作者本人能改/删（服务端 RPC 也是这么卡的，管理员也不行） */
const canManage = computed(() => {
  const record = ball.value
  return Boolean(
    auth.canWrite && record && record.owner_id !== null && record.owner_id === auth.user?.id
  )
})

/**
 * 返回列表
 *
 * 优先 `back()`：列表页的筛选条件写在 URL query 上，回退能原样还原，
 * 顺带回到之前的滚动位置。直接打开详情页（没有上一条历史）时才 push 到列表。
 */
function goBack(): void {
  if (window.history.state?.back) router.back()
  else void router.push(`/balls/${props.color}`)
}

async function onDelete(): Promise<void> {
  const record = ball.value
  if (!record) return

  const confirmed = await ElMessageBox.confirm(
    '删除后该条打法会从列表里消失（服务端是软删除）。确定删除吗？',
    '删除确认',
    { type: 'warning', confirmButtonText: '删除', cancelButtonText: '取消' }
  ).catch(() => false)
  if (!confirmed) return

  const result = await deleteBall(record.id, dataset.version)
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
          <span>返回{{ colorName }}</span>
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

    <el-empty v-else-if="!ball" description="这条打法不存在，或已被作者删除">
      <el-button type="primary" @click="goBack">返回列表</el-button>
    </el-empty>

    <article v-else class="detail__body card">
      <h1 class="detail__title">
        <span class="detail__strength">{{ strengthText }}</span>
        <span>{{ ball.method }}</span>
      </h1>

      <p class="detail__meta">
        <span>{{ colorName }}</span>
        <span>{{ pocketText }}</span>
        <span>作者：{{ ball.updated_by || '未知' }}</span>
        <span>更新时间：{{ updatedText }}</span>
      </p>

      <!-- 文字在上，图片在下 -->
      <dl class="detail__fields">
        <div class="field">
          <dt>方法</dt>
          <dd>{{ ball.sight || '—' }}</dd>
        </div>
        <div class="field">
          <dt>低杆走位</dt>
          <dd>{{ ball.low_comp || '—' }}</dd>
        </div>
        <div class="field">
          <dt>高杆走位</dt>
          <dd>{{ ball.high_comp || '—' }}</dd>
        </div>
        <div class="field">
          <dt>补充说明</dt>
          <dd>{{ ball.remark || '—' }}</dd>
        </div>
      </dl>

      <!--
        图片区：两列
        左列：击球点 / 蓝点 上下排列，固定 150×150 拉伸（不点开）
        右列：路线图按预览尺寸显示，点开看原图
      -->
      <div class="detail__media">
        <div class="media__col">
          <figure class="media">
            <figcaption class="media__label">击球点</figcaption>
            <div class="media__box media__box--square">
              <img v-if="impactUrl" :src="impactUrl" alt="击球点示意图" loading="lazy" />
              <span v-else class="media__empty">无图</span>
            </div>
          </figure>

          <figure class="media">
            <figcaption class="media__label">蓝点</figcaption>
            <div class="media__box media__box--square">
              <img v-if="blueUrl" :src="blueUrl" alt="蓝点示意图" loading="lazy" />
              <span v-else class="media__empty">无图</span>
            </div>
          </figure>
        </div>

        <figure class="media media--route">
          <figcaption class="media__label">路线图</figcaption>
          <button
            v-if="routeUrl"
            class="media__box media__box--route"
            type="button"
            title="查看原图"
            @click="viewerVisible = true"
          >
            <img :src="routeUrl" alt="路线图" loading="lazy" />
          </button>
          <div v-else class="media__box media__box--route media__box--empty">无路线图</div>
        </figure>
      </div>

      <!-- 评论区（T4）插在这里 -->
    </article>

    <ElImageViewer
      v-if="viewerVisible && routeUrl"
      :url-list="[routeUrl]"
      teleported
      @close="viewerVisible = false"
    />

    <BallFormDialog
      v-model:visible="formVisible"
      :ball="ball"
      :default-color="ball?.color_code ?? color"
      :default-pocket="ball?.pocket_code ?? 'top_left'"
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

/* 正文限宽：走位说明可能几百字，一行铺满整窗会很难读 */
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
  display: flex;
  flex-wrap: wrap;
  gap: 0.5rem 0.75rem;
  align-items: baseline;
  margin: 0;
  font-size: clamp(1.25rem, 1.7vw, 1.5rem);
  font-weight: 500;
  line-height: 1.4;
  color: var(--text-1);
  overflow-wrap: anywhere;
}

/* 力度是这条打法的视觉锚点（旧版就是 30px 大字） */
.detail__strength {
  color: var(--primary);
  font-weight: 600;
}

.detail__meta {
  display: flex;
  flex-wrap: wrap;
  gap: 0.25rem 1.25rem;
  margin: 0;
  font-size: var(--font-size-sm);
  color: var(--text-2);
}

/*
 * 图片区：两列
 *   左列 击球点 / 蓝点 上下排列，固定 150×150（9.375rem），object-fit: fill 拉伸
 *   右列 路线图，按预览尺寸（最宽 100%、最高 45vh）显示，可点开原图
 */
.detail__media {
  display: grid;
  grid-template-columns: auto minmax(0, 1fr);
  gap: 1rem;
  align-items: start;
  padding-top: 0.25rem;
  border-top: 1px solid var(--border);
}

.media__col {
  display: flex;
  flex-direction: column;
  gap: 0.75rem;
}

.media {
  display: flex;
  flex-direction: column;
  gap: 0.375rem;
  min-width: 0;
  margin: 0;
}

.media__label {
  font-size: var(--font-size-sm);
  color: var(--text-3);
}

.media__box {
  display: grid;
  place-items: center;
  overflow: hidden;
  /* 图多是白底或透明底，这里不加底衬，暗色主题下不留白块 */
  background: transparent;
  border: 1px solid var(--border);
  border-radius: var(--radius-md);
}

/* 击球点 / 蓝点：固定 150×150，拉伸填满（原图 60~100px，会放大） */
.media__box--square {
  width: 9.375rem;
  height: 9.375rem;
}

.media__box--square img {
  width: 100%;
  height: 100%;
  object-fit: fill;
}

/* 路线图：框贴着图片，可点开原图 */
.media__box--route {
  width: fit-content;
  max-width: 100%;
  padding: 0;
  cursor: zoom-in;
}

.media__box--route img {
  display: block;
  max-width: 100%;
  max-height: 45vh;
  object-fit: contain;
}

.media__box--empty {
  width: 100%;
  padding: 2rem 0;
  cursor: default;
  border-style: dashed;
}

.media__empty {
  font-size: var(--font-size-sm);
  color: var(--text-3);
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
  /* 走位说明有手工换行 */
  white-space: pre-wrap;
  overflow-wrap: anywhere;
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
