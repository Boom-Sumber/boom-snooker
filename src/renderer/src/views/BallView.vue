<script setup lang="ts">
/**
 * 彩球列表页（核心页）
 *
 * 交互照旧版 WPF 的 ColorBallView：
 *   1. 进页面默认选中「左上袋」，**不自动查询**（旧版列表是空的）
 *   2. 换袋口 → 清空已选进袋方式 + 清空结果，重算该袋口下的进袋方式
 *   3. 选进袋方式 → 点「查询」→ 按 袋口 + 进袋方式 过滤
 *
 * 数据来自本地快照（`useDatasetStore().ballsByColor`），断网也能查。
 */
import { computed, ref, watch } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { ElMessage, ElMessageBox } from 'element-plus'
import BallCard from '@renderer/components/BallCard.vue'
import BallFormDialog from '@renderer/components/BallFormDialog.vue'
import { BALL_LABELS } from '@renderer/navigation/menu'
import { useAuthStore, useDatasetStore, type Ball } from '@renderer/stores'
import { deleteBall } from '@shared/api/balls'

const props = defineProps<{ color: string }>()

const route = useRoute()
const router = useRouter()
const dataset = useDatasetStore()
const auth = useAuthStore()

/** 字典还没同步下来时的兜底（顺序与旧版 6 个 radio 一致） */
const POCKET_FALLBACK = [
  { code: 'top_left', name: '左上袋' },
  { code: 'bottom_left', name: '左下袋' },
  { code: 'top_middle', name: '上中袋' },
  { code: 'bottom_middle', name: '下中袋' },
  { code: 'top_right', name: '右上袋' },
  { code: 'bottom_right', name: '右下袋' }
]

const pockets = computed(() => {
  const rows = dataset.dict
    .filter((row) => row.kind === 'pocket')
    .sort((a, b) => a.sort - b.sort)
    .map((row) => ({ code: row.code, name: row.name_zh }))
  return rows.length > 0 ? rows : POCKET_FALLBACK
})

const title = computed(() => BALL_LABELS[props.color] ?? dataset.dictName('color', props.color))

/** 当前彩球的全部打法（未筛选） */
const colorBalls = computed(() => dataset.ballsByColor.get(props.color) ?? [])

/**
 * 筛选状态写进 URL query（`?pocket=top_left&method=xxx`）
 *
 * 拆出详情页之后，列表页会**重新挂载**：不写 query 的话，从详情页返回时
 * 袋口回到默认、结果为空，用户得重查一遍。写进 URL 后：
 *   - 详情页 `router.back()` 回来，筛选条件原样还原
 *   - 刷新 / 直接打开这个地址也能看到同样的结果
 */
const queryPocket = typeof route.query.pocket === 'string' ? route.query.pocket : ''
const queryMethod = typeof route.query.method === 'string' ? route.query.method : ''

const pocket = ref(
  queryPocket && pockets.value.some((item) => item.code === queryPocket)
    ? queryPocket
    : (pockets.value[0]?.code ?? 'top_left')
)
const method = ref(queryMethod)

/** 点过「查询」之后的筛选条件；null = 还没查过，列表为空（与旧版一致） */
const submitted = ref<{ pocket: string; method: string } | null>(
  queryMethod ? { pocket: pocket.value, method: queryMethod } : null
)

/** 该袋口下出现过的进袋方式（去重，空值剔除） */
const methods = computed(() => {
  const seen = new Set<string>()
  for (const ball of colorBalls.value) {
    if (ball.pocket_code === pocket.value && ball.method) seen.add(ball.method)
  }
  return [...seen].sort((a, b) => a.localeCompare(b, 'zh-Hans-CN'))
})

const results = computed(() => {
  const query = submitted.value
  if (!query) return []
  return colorBalls.value.filter(
    (ball) => ball.pocket_code === query.pocket && ball.method === query.method
  )
})

/** 换袋口：清空进袋方式与结果（旧版行为），URL 上的筛选也一起清掉 */
watch(pocket, () => {
  method.value = ''
  submitted.value = null
  void router.replace({ query: {} })
})

/** 换彩球（同一个组件复用）：整体重置 */
watch(
  () => props.color,
  () => {
    pocket.value = pockets.value[0]?.code ?? 'top_left'
    method.value = ''
    submitted.value = null
    void router.replace({ query: {} })
  }
)

/**
 * 外部导航把 query 清掉时（比如再点一次侧栏「黑球」），列表也回到"没查过"的状态
 *
 * 同一个路由记录复用组件，不会重新挂载，不监听的话会出现「地址栏没条件、
 * 列表却还有结果」的错位。自己 `replace({ query: {} })` 时 submitted 已经是 null，
 * 这里不会重复触发。
 */
watch(
  () => [route.query.pocket, route.query.method],
  ([pocketQuery, methodQuery]) => {
    if (!pocketQuery && !methodQuery && submitted.value) {
      submitted.value = null
      method.value = ''
    }
  }
)

function search(): void {
  if (!method.value) {
    ElMessage.warning('请先选择进袋方式')
    return
  }
  submitted.value = { pocket: pocket.value, method: method.value }
  void router.replace({ query: { pocket: pocket.value, method: method.value } })
}

function onCreate(): void {
  editingBall.value = null
  formVisible.value = true
}

/** 点卡片进详情页（方法 / 走位补偿 / 补充说明 / 三张图都在那边） */
function openDetail(ball: Ball): void {
  void router.push(`/balls/${props.color}/${ball.id}`)
}

/** 表单对话框 */
const formVisible = ref(false)
const editingBall = ref<Ball | null>(null)

/** 只有作者本人能改/删（服务端 RPC 也是这么卡的，管理员也不行） */
function canManage(ball: Ball): boolean {
  return auth.canWrite && ball.owner_id !== null && ball.owner_id === auth.user?.id
}

function onEdit(ball: Ball): void {
  editingBall.value = ball
  formVisible.value = true
}

async function onDelete(ball: Ball): Promise<void> {
  const confirmed = await ElMessageBox.confirm(
    '删除后该条打法会从列表里消失（服务端是软删除）。确定删除吗？',
    '删除确认',
    { type: 'warning', confirmButtonText: '删除', cancelButtonText: '取消' }
  ).catch(() => false)
  if (!confirmed) return

  const result = await deleteBall(ball.id, dataset.version)
  if (!result.ok) {
    if (result.conflict) void dataset.sync(true)
    ElMessage.error(result.message ?? '删除失败')
    return
  }

  ElMessage.success('已删除')
  await dataset.sync(true)
}

/** 保存成功后刷新快照：记录被写库 → dataset_version 变了 → 拉新快照 */
async function onSaved(): Promise<void> {
  await dataset.sync(true)
}
</script>

<template>
  <section class="ball-view">
    <header class="ball-view__head">
      <div>
        <h1 class="ball-view__title">{{ title }}</h1>
        <p class="ball-view__sub">共 {{ colorBalls.length }} 条打法 · 按袋口与进袋方式筛选</p>
      </div>
      <el-button v-if="auth.canWrite" type="primary" @click="onCreate">新增</el-button>
    </header>

    <!-- 筛选区 -->
    <div class="filter card">
      <el-radio-group v-model="pocket" class="filter__pockets">
        <el-radio-button v-for="item in pockets" :key="item.code" :value="item.code">
          {{ item.name }}
        </el-radio-button>
      </el-radio-group>

      <div class="filter__row">
        <el-select
          v-model="method"
          class="filter__select"
          placeholder="选择进袋方式"
          filterable
          clearable
        >
          <el-option v-for="item in methods" :key="item" :label="item" :value="item" />
        </el-select>

        <el-button type="primary" :disabled="!method" @click="search">查询</el-button>

        <span v-if="!methods.length" class="filter__hint">
          该袋口下暂无进袋方式，换一个袋口看看
        </span>
      </div>
    </div>

    <!-- 结果区 -->
    <div v-if="!dataset.isReady" class="state">
      <el-skeleton :rows="3" animated />
      <p class="state__text">数据还没同步完成，稍等一下…</p>
    </div>

    <p v-else-if="!submitted" class="state__text state__text--center">选择进袋方式后点「查询」</p>

    <p v-else-if="results.length === 0" class="state__text state__text--center">
      该袋口下没有这个进袋方式的记录
    </p>

    <div v-else class="ball-view__grid">
      <BallCard
        v-for="ball in results"
        :key="ball.id"
        :ball="ball"
        :strength-text="dataset.dictName('strength', ball.strength_code)"
        @open="openDetail(ball)"
      >
        <template #actions>
          <el-dropdown
            v-if="canManage(ball)"
            trigger="click"
            @command="(command: string) => (command === 'edit' ? onEdit(ball) : onDelete(ball))"
          >
            <el-button size="small" text title="更多操作">···</el-button>
            <template #dropdown>
              <el-dropdown-menu>
                <el-dropdown-item command="edit">编辑</el-dropdown-item>
                <el-dropdown-item command="delete" divided>删除</el-dropdown-item>
              </el-dropdown-menu>
            </template>
          </el-dropdown>
        </template>
      </BallCard>
    </div>

    <BallFormDialog
      v-model:visible="formVisible"
      :ball="editingBall"
      :default-color="color"
      :default-pocket="pocket"
      @saved="onSaved"
    />
  </section>
</template>

<style scoped>
.ball-view {
  display: flex;
  flex-direction: column;
  gap: 0.875rem;
  padding: clamp(16px, 2.2vw, 28px);
}

.ball-view__head {
  display: flex;
  gap: 1rem;
  align-items: flex-start;
  justify-content: space-between;
}

.ball-view__title {
  margin: 0;
  font-size: clamp(1.25rem, 1.6vw, 1.5rem);
  font-weight: 500;
  color: var(--text-1);
}

.ball-view__sub {
  margin: 0.25rem 0 0;
  font-size: var(--font-size-sm);
  color: var(--text-2);
}

.filter {
  display: flex;
  flex-direction: column;
  gap: 0.75rem;
  padding: 0.875rem 1rem;
}

.filter__pockets {
  display: flex;
  flex-wrap: wrap;
  gap: 0.25rem;
}

.filter__row {
  display: flex;
  flex-wrap: wrap;
  gap: 0.75rem;
  align-items: center;
}

.filter__select {
  width: 18rem;
  max-width: 100%;
}

.filter__hint {
  font-size: var(--font-size-sm);
  color: var(--text-3);
}

.ball-view__grid {
  display: grid;
  /* 卡片只剩「图 + 力度/进袋方式 + 作者/日期」，可以排得更密 */
  grid-template-columns: repeat(auto-fill, minmax(15rem, 1fr));
  gap: 0.875rem;
  max-width: 100%;
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

.state__text--center {
  padding: 3rem 0;
  text-align: center;
}
</style>
