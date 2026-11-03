<script setup lang="ts">
/**
 * 进阶系列页（5 个系列共用一个组件，靠路由参数切）
 *
 * 结构比彩球页简单：没有"袋口 + 进袋方式"两级筛选，
 * 系列本身就是唯一维度 —— 侧栏 5 项和页面顶部 5 个页签都指向同一个路由参数。
 * 列表直接平铺（旧版是 CoverView 封面点开看正文），图可点开大图。
 *
 * 数据来自本地快照（`useDatasetStore().advancedByCategory`），断网也能看。
 */
import { computed, ref, watch } from 'vue'
import { useRouter } from 'vue-router'
import { ElMessage, ElMessageBox } from 'element-plus'
import AdvancedCard from '@renderer/components/AdvancedCard.vue'
import AdvancedFormDialog from '@renderer/components/AdvancedFormDialog.vue'
import { CATEGORY_LABELS } from '@renderer/navigation/menu'
import { useAuthStore, useDatasetStore, useNetworkStore, type Advanced } from '@renderer/stores'
import { deleteAdvanced } from '@shared/api/advanced'

const props = defineProps<{ category: string }>()

const router = useRouter()
const dataset = useDatasetStore()
const auth = useAuthStore()
/** 新增 / 编辑 / 删除都要联网，离线时入口置灰（T6.1） */
const network = useNetworkStore()

const title = computed(
  () => CATEGORY_LABELS[props.category] ?? dataset.dictName('category', props.category)
)

/** 5 个系列页签：顺序与侧栏一致（不按字典 sort，避免两边顺序不一样） */
const categories = computed(() =>
  Object.entries(CATEGORY_LABELS).map(([code, name]) => ({
    code,
    name,
    count: dataset.advancedByCategory.get(code)?.length ?? 0
  }))
)

/** 当前系列的全部条目，最近更新的在前 */
const items = computed(() =>
  [...(dataset.advancedByCategory.get(props.category) ?? [])].sort((a, b) =>
    b.updated_at.localeCompare(a.updated_at)
  )
)

const formVisible = ref(false)
const editingItem = ref<Advanced | null>(null)

/** 只有作者本人能改/删（服务端 RPC 也是这么卡的，管理员也不行） */
function canManage(item: Advanced): boolean {
  return auth.canWrite && item.owner_id !== null && item.owner_id === auth.user?.id
}

function switchCategory(code: string): void {
  if (code === props.category) return
  void router.push(`/advanced/${code}`)
}

/** `el-radio-group` 的 change 参数类型是宽泛的 `string | number | boolean` */
function onCategoryChange(value: string | number | boolean | undefined): void {
  switchCategory(String(value))
}

function onCreate(): void {
  editingItem.value = null
  formVisible.value = true
}

/** 点卡片进详情页（正文、大图、以后的评论区都在那边） */
function openDetail(item: Advanced): void {
  void router.push(`/advanced/${props.category}/${item.id}`)
}

function onEdit(item: Advanced): void {
  editingItem.value = item
  formVisible.value = true
}

async function onDelete(item: Advanced): Promise<void> {
  const confirmed = await ElMessageBox.confirm(
    '删除后该条进阶会从列表里消失（服务端是软删除）。确定删除吗？',
    '删除确认',
    { type: 'warning', confirmButtonText: '删除', cancelButtonText: '取消' }
  ).catch(() => false)
  if (!confirmed) return

  const result = await deleteAdvanced(item.id, dataset.version)
  if (!result.ok) {
    if (result.conflict) void dataset.sync(true)
    ElMessage.error(result.message ?? '删除失败')
    return
  }

  ElMessage.success('已删除')
  await dataset.sync(true)
}

async function onSaved(): Promise<void> {
  await dataset.sync(true)
}

/** 换系列时把残留的对话框状态清掉（否则编辑中的条目会带到另一个系列） */
watch(
  () => props.category,
  () => {
    formVisible.value = false
    editingItem.value = null
  }
)
</script>

<template>
  <section class="advanced-view">
    <header class="advanced-view__head">
      <div>
        <h1 class="advanced-view__title">{{ title }}</h1>
        <p class="advanced-view__sub">共 {{ items.length }} 条 · 点卡片查看完整内容</p>
      </div>
      <el-button v-if="auth.canWrite" type="primary" :disabled="network.offline" @click="onCreate">
        新增
      </el-button>
    </header>

    <!-- 系列切换：与侧栏 5 项同一个路由参数，两边始终同步 -->
    <div class="filter card">
      <el-radio-group :model-value="category" class="filter__categories" @change="onCategoryChange">
        <el-radio-button v-for="item in categories" :key="item.code" :value="item.code">
          {{ item.name }}
          <span class="filter__count">{{ item.count }}</span>
        </el-radio-button>
      </el-radio-group>
    </div>

    <div v-if="!dataset.isReady" class="state">
      <el-skeleton :rows="3" animated />
      <p class="state__text">数据还没同步完成，稍等一下…</p>
    </div>

    <p v-else-if="items.length === 0" class="state__text state__text--center">这个系列还没有内容</p>

    <div v-else class="advanced-view__grid">
      <AdvancedCard v-for="item in items" :key="item.id" :item="item" @open="openDetail(item)">
        <template #actions>
          <el-dropdown
            v-if="canManage(item)"
            trigger="click"
            @command="(command: string) => (command === 'edit' ? onEdit(item) : onDelete(item))"
          >
            <el-button size="small" text title="更多操作" :disabled="network.offline"
              >···</el-button
            >
            <template #dropdown>
              <el-dropdown-menu>
                <el-dropdown-item command="edit">编辑</el-dropdown-item>
                <el-dropdown-item command="delete" divided>删除</el-dropdown-item>
              </el-dropdown-menu>
            </template>
          </el-dropdown>
        </template>
      </AdvancedCard>
    </div>

    <AdvancedFormDialog
      v-model:visible="formVisible"
      :item="editingItem"
      :default-category="category"
      @saved="onSaved"
    />
  </section>
</template>

<style scoped>
.advanced-view {
  display: flex;
  flex-direction: column;
  gap: 0.875rem;
  padding: clamp(16px, 2.2vw, 28px);
}

.advanced-view__head {
  display: flex;
  gap: 1rem;
  align-items: flex-start;
  justify-content: space-between;
}

.advanced-view__title {
  margin: 0;
  font-size: clamp(1.25rem, 1.6vw, 1.5rem);
  font-weight: 500;
  color: var(--text-1);
}

.advanced-view__sub {
  margin: 0.25rem 0 0;
  font-size: var(--font-size-sm);
  color: var(--text-2);
}

.filter {
  padding: 0.875rem 1rem;
}

.filter__categories {
  display: flex;
  flex-wrap: wrap;
  gap: 0.25rem;
}

.filter__count {
  margin-left: 0.375rem;
  font-size: var(--font-size-sm);
  opacity: 0.7;
}

.advanced-view__grid {
  display: grid;
  /* 卡片只剩「图 + 标题 + 作者/日期」，可以排得更密 */
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
