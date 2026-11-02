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
 * 评论区（T4.2）挂在页面底部，是独立卡片：评论不进快照，必须联网取。
 *
 * 数据不额外请求：按 id 从本地快照取（`dataset.findBall`），离线也能看。
 */
import { computed, ref, watch } from 'vue'
import { useRouter } from 'vue-router'
import { ElImageViewer, ElMessage, ElMessageBox } from 'element-plus'
import { ArrowLeftBold } from '@element-plus/icons-vue'
import BallFormDialog from '@renderer/components/BallFormDialog.vue'
import CommentSection from '@renderer/components/CommentSection.vue'
import { BALL_LABELS } from '@renderer/navigation/menu'
import { useAuthStore, useDatasetStore, type Ball } from '@renderer/stores'
import { imageUrl } from '@shared/media/url'
import { deleteBall } from '@shared/api/balls'
import { getReviewBall, reviewRecord } from '@shared/api/review'
import { getMyBall, type BallWithReview, type ReviewStatus } from '@shared/api/myRecords'
import ReviewStamp from '@renderer/components/ReviewStamp.vue'
import AuthorTag from '@renderer/components/AuthorTag.vue'

const props = defineProps<{ color: string; id: string }>()

const router = useRouter()
const dataset = useDatasetStore()
const auth = useAuthStore()

/**
 * 审核预览 / 作者预览（T4.6 / T4.12）
 *
 * 待审与驳回的记录**不在快照里**，所以要按 id 单独拉：
 *   · 是我自己的 → `get_my_record`（带审核人信息），作者能看见自己的待审 / 驳回内容
 *   · 不是我的 + 我是管理员 → `get_review_record`（审核预览，带通过 / 驳回按钮）
 */
const myBall = ref<BallWithReview | null>(null)
const reviewBall = ref<Ball | null>(null)
const extraLoading = ref(false)
const reviewError = ref('')

const inSnapshot = computed(() => dataset.findBall(props.id))
const ball = computed<Ball | null>(
  () => inSnapshot.value ?? (myBall.value as Ball | null) ?? reviewBall.value
)

/** 是我自己的记录（快照里或单独拉到的都算） */
const isMine = computed(() =>
  Boolean(ball.value?.owner_id && ball.value.owner_id === auth.user?.id)
)
/** 我的这条记录当前状态：只有作者自己拉到的 myBall 才有 */
const myStatus = computed<ReviewStatus | null>(
  () => (myBall.value?.review_status as ReviewStatus | undefined) ?? null
)
const isPending = computed(() => isMine.value && myStatus.value === 'pending')
const isRejected = computed(() => isMine.value && myStatus.value === 'rejected')

/** 管理员审核预览：快照没有、不是我的、但拉到了待审行 */
const isReview = computed(() => !inSnapshot.value && !isMine.value && reviewBall.value !== null)

async function loadExtra(): Promise<void> {
  if (!dataset.isReady) return

  const snapshot = dataset.findBall(props.id)

  // 快照里有的：只有作者需要补审核信息（别人拿不到，服务端会拒）
  if (snapshot) {
    if (auth.isSignedIn && snapshot.owner_id === auth.user?.id) {
      const mine = await getMyBall(props.id)
      if (mine.ok) myBall.value = mine.data
    }
    return
  }

  if (!auth.isSignedIn) return

  extraLoading.value = true
  reviewError.value = ''

  // 先按"我的投稿"取：作者能看到自己的待审 / 驳回
  const mine = await getMyBall(props.id)
  if (mine.ok) {
    myBall.value = mine.data
    extraLoading.value = false
    return
  }

  // 不是我的：管理员可以走审核预览
  if (auth.isAdmin) {
    const result = await getReviewBall(props.id)
    extraLoading.value = false
    if (!result.ok) {
      reviewError.value = result.message
      return
    }
    reviewBall.value = result.data as Ball
    return
  }

  extraLoading.value = false
}

/** 审核完回到列表：这条记录要么已发布、要么被驳回，都该离开详情页 */
function backAfterReview(): void {
  // 对话框没开，靠全局事件让顶栏角标立刻减一
  window.dispatchEvent(new Event('snooker:review-changed'))
  goBack()
}

async function approveReview(): Promise<void> {
  if (!reviewBall.value) return
  const result = await reviewRecord('ball', reviewBall.value.id, 'visible')
  if (!result.ok) {
    ElMessage.error(result.message)
    return
  }
  ElMessage.success('已通过，这条打法已发布')
  await dataset.sync(true)
  backAfterReview()
}

async function rejectReview(): Promise<void> {
  if (!reviewBall.value) return

  const answer = await ElMessageBox.prompt('驳回原因会通知给作者', '驳回这条打法', {
    confirmButtonText: '驳回',
    cancelButtonText: '取消',
    inputType: 'textarea',
    inputPlaceholder: '比如：图片不清晰 / 描述与图片不符',
    inputValidator: (value: string) => (value && value.length > 200 ? '最多 200 字' : true)
  }).catch(() => null)
  if (!answer) return

  const result = await reviewRecord('ball', reviewBall.value.id, 'rejected', answer.value ?? '')
  if (!result.ok) {
    ElMessage.error(result.message)
    return
  }
  ElMessage.success('已驳回')
  backAfterReview()
}

watch(
  // 四个都可能是"晚到"的：路由 id、快照、登录态、当前用户
  () => [props.id, dataset.isReady, auth.isAdmin, auth.user?.id],
  () => {
    myBall.value = null
    reviewBall.value = null
    reviewError.value = ''
    void loadExtra()
  },
  { immediate: true }
)

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
  // 编辑后可能从 rejected 变回 pending，状态条要跟着变
  myBall.value = null
  void loadExtra()
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

      <!-- 待审期间不能改内容（服务端也会拒 PENDING_LOCKED），但允许删除 -->
      <div v-if="canManage && !isReview" class="detail__actions">
        <el-button v-if="!isPending" @click="formVisible = true">编辑</el-button>
        <el-button type="danger" plain @click="onDelete">删除</el-button>
      </div>
    </header>

    <div v-if="!dataset.isReady || extraLoading" class="state">
      <el-skeleton :rows="5" animated />
      <p class="state__text">数据还没同步完成，稍等一下…</p>
    </div>

    <el-empty v-else-if="!ball" :description="reviewError || '这条打法不存在，或已被作者删除'">
      <el-button type="primary" @click="goBack">返回列表</el-button>
    </el-empty>

    <article v-else class="detail__body card">
      <!-- 作者视角：待审 / 驳回时的状态条（T4.12 / T4.13） -->
      <div v-if="isPending" class="status-bar">
        <span class="status-bar__text">这条打法正在审核中，审核期间不能修改</span>
        <el-tag size="small" type="warning" effect="plain">待审核</el-tag>
      </div>
      <div v-else-if="isRejected" class="status-bar status-bar--rejected">
        <div class="status-bar__main">
          <span class="status-bar__text">
            未通过审核<template v-if="myBall?.review_note">：{{ myBall.review_note }}</template>
          </span>
          <ReviewStamp
            :name="myBall?.reviewer_name"
            :role="myBall?.reviewer_role"
            :at="myBall?.reviewed_at"
            status="rejected"
          />
        </div>
        <span class="status-bar__text">可以修改后重新提交审核</span>
      </div>

      <!-- 审核预览：快照里没有的待审记录，看完直接通过/驳回 -->
      <div v-if="isReview" class="review-bar">
        <span class="review-bar__text">这条打法还没通过审核，下面是完整预览（含图片）</span>
        <div class="review-bar__actions">
          <el-button size="small" @click="rejectReview">驳回</el-button>
          <el-button size="small" type="primary" @click="approveReview">通过</el-button>
        </div>
      </div>
      <!-- 标题行：左「力度 + 进袋方式」，右上「什么球 / 哪个袋」用胶囊标出来 -->
      <header class="detail__head">
        <h1 class="detail__title">
          <span class="detail__strength">{{ strengthText }}</span>
          <span class="detail__method">{{ ball.method }}</span>
        </h1>

        <div class="detail__tags">
          <span class="tag">{{ colorName }}</span>
          <span class="tag">{{ pocketText }}</span>
        </div>
      </header>

      <p class="detail__meta">
        <span>作者：<AuthorTag :name="ball.updated_by" :deleted="ball.author_deleted" /></span>
        <span>更新时间：{{ updatedText }}</span>
      </p>

      <!-- 已发布 + 是我自己的：显示审核回显（别人看不到） -->
      <ReviewStamp
        v-if="isMine && !isPending && !isRejected && myBall?.reviewed_at"
        :name="myBall?.reviewer_name"
        :role="myBall?.reviewer_role"
        :at="myBall?.reviewed_at"
        status="visible"
      />

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

      <!-- 评论区（T4.2）在下方独立区块，不放在卡片里 -->
    </article>

    <CommentSection
      v-if="dataset.isReady && ball && inSnapshot"
      class="detail__comments"
      type="ball"
      :target-id="ball.id"
    />

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

/* 标题行：左边「力度 + 进袋方式」，右边「球 / 袋」胶囊，同一行 */
.detail__head {
  display: flex;
  flex-wrap: wrap;
  gap: 0.5rem 0.75rem;
  align-items: center;
  justify-content: space-between;
}

.detail__title {
  display: flex;
  flex: 1;
  flex-wrap: wrap;
  gap: 0.5rem 0.75rem;
  align-items: baseline;
  min-width: 0;
  margin: 0;
  font-size: clamp(1.25rem, 1.7vw, 1.5rem);
  font-weight: 500;
  line-height: 1.4;
  color: var(--text-1);
  overflow-wrap: anywhere;
}

.detail__tags {
  display: flex;
  flex: none;
  flex-wrap: wrap;
  gap: 0.5rem;
  align-items: center;
}

/*
 * 彩球 / 袋口胶囊：实心主题色 + 白字，比浅底更显眼（用户要求"看得显眼一点"）
 * 亮暗两套主题都用 --primary，自动跟随
 */
.tag {
  padding: 0.25rem 0.75rem;
  font-size: 0.875rem;
  line-height: 1.4;
  color: #fff;
  white-space: nowrap;
  background: var(--primary);
  border-radius: 999px;
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

/* 作者视角的状态条：待审 / 未通过 */
.status-bar {
  display: flex;
  flex-wrap: wrap;
  gap: 0.5rem;
  align-items: center;
  justify-content: space-between;
  padding: 0.5rem 0.75rem;
  font-size: var(--font-size-sm);
  color: var(--text-1);
  background: color-mix(in srgb, var(--warning, #e9af20) 12%, transparent);
  border: 1px solid color-mix(in srgb, var(--warning, #e9af20) 35%, transparent);
  border-radius: var(--radius-md);
}

.status-bar--rejected {
  background: var(--surface-2);
  border-color: var(--border);
}

.status-bar__main {
  display: flex;
  flex-wrap: wrap;
  gap: 0.5rem;
  align-items: center;
}

/* 审核预览条：和正文同一张卡里，一眼能看出"这不是正式内容" */
.review-bar {
  display: flex;
  flex-wrap: wrap;
  gap: 0.75rem;
  align-items: center;
  justify-content: space-between;
  padding: 0.5rem 0.75rem;
  font-size: var(--font-size-sm);
  color: var(--text-1);
  background: color-mix(in srgb, var(--primary) 10%, transparent);
  border: 1px solid color-mix(in srgb, var(--primary) 35%, transparent);
  border-radius: var(--radius-md);
}

.review-bar__actions {
  display: flex;
  gap: 0.5rem;
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
