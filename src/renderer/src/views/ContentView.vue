<script setup lang="ts">
/**
 * 文案管理（D31）
 *
 * 只给超级管理员用：首页等静态文案存在 `site_sections` / `site_points`，
 * 这里编辑、保存即 bump `dataset_version`，所有客户端下次启动自动更新，不用发版。
 *
 * 交互约定：
 *   · 改的是**本地草稿**，点「保存全部」才提交（避免每敲一个字就发请求）
 *   · 保存时按卡片顺序写回 `sort`，所以拖不了顺序也能用「上移 / 下移」调
 *   · 条目整组覆盖：删掉的条目保存后就不在了，没有回收站
 */
import { computed, onMounted, ref, watch } from 'vue'
import { ElMessage, ElMessageBox } from 'element-plus'
import { useAuthStore, useDatasetStore, useNetworkStore } from '@renderer/stores'
import { deleteSiteSection, saveSiteSection } from '@shared/api/content'
import type { SiteSectionDraft } from '@shared/types/content'

const auth = useAuthStore()
const dataset = useDatasetStore()
/** 离线时只允许改草稿、不允许保存（T6.1） */
const network = useNetworkStore()

const drafts = ref<SiteSectionDraft[]>([])
const dirty = ref(false)
const saving = ref(false)

const canEdit = computed(() => auth.isSuperadmin)

/** 快照里的文案 → 可编辑草稿（深拷贝，避免直接改 store 里的对象） */
function fromSnapshot(): SiteSectionDraft[] {
  return dataset.content.map((section) => ({
    key: section.key,
    title: section.title,
    intro: section.intro ?? '',
    sort: section.sort ?? 0,
    points: (section.points ?? []).map((point) => ({
      label: point.label ?? '',
      body: point.body
    }))
  }))
}

function reset(): void {
  drafts.value = fromSnapshot()
  dirty.value = false
}

/** 任何输入都标记为脏，顶部会提示「有未保存的修改」 */
function markDirty(): void {
  dirty.value = true
}

function addSection(): void {
  drafts.value.push({
    key: `home:custom-${Date.now().toString(36)}`,
    title: '',
    intro: '',
    sort: drafts.value.length,
    points: [{ label: '', body: '' }],
    isNew: true
  })
  dirty.value = true
}

function removeSection(index: number): void {
  const target = drafts.value[index]
  if (!target) return

  // 新建还没保存过的，直接从草稿里去掉就行
  if (target.isNew) {
    drafts.value.splice(index, 1)
    dirty.value = true
    return
  }

  void ElMessageBox.confirm(
    `确定删除「${target.title || target.key}」这一组？组内 ${target.points.length} 条会一起消失。`,
    '删除分组',
    { type: 'warning', confirmButtonText: '删除', cancelButtonText: '取消' }
  )
    .then(async () => {
      const result = await deleteSiteSection(target.key)
      if (!result.ok) {
        ElMessage.error(result.message)
        return
      }
      drafts.value.splice(index, 1)
      dirty.value = false
      ElMessage.success('已删除')
      await dataset.sync(true)
      reset()
    })
    .catch(() => undefined)
}

function addPoint(section: SiteSectionDraft): void {
  section.points.push({ label: '', body: '' })
  dirty.value = true
}

function removePoint(section: SiteSectionDraft, index: number): void {
  section.points.splice(index, 1)
  dirty.value = true
}

function movePoint(section: SiteSectionDraft, index: number, delta: number): void {
  const next = index + delta
  if (next < 0 || next >= section.points.length) return
  const [item] = section.points.splice(index, 1)
  section.points.splice(next, 0, item)
  dirty.value = true
}

function moveSection(index: number, delta: number): void {
  const next = index + delta
  if (next < 0 || next >= drafts.value.length) return
  const [item] = drafts.value.splice(index, 1)
  drafts.value.splice(next, 0, item)
  dirty.value = true
}

async function saveAll(): Promise<void> {
  if (saving.value) return

  const emptyTitle = drafts.value.findIndex((item) => !item.title.trim())
  if (emptyTitle >= 0) {
    ElMessage.warning(`第 ${emptyTitle + 1} 组还没有标题`)
    return
  }

  saving.value = true
  try {
    for (const [index, section] of drafts.value.entries()) {
      const payload = {
        key: section.key,
        title: section.title.trim(),
        intro: section.intro?.trim() || null,
        sort: index,
        points: section.points
          .filter((point) => point.body.trim())
          .map((point) => ({ label: point.label?.trim() || null, body: point.body.trim() }))
      }
      const result = await saveSiteSection(payload)
      if (!result.ok) {
        ElMessage.error(`「${section.title}」保存失败：${result.message}`)
        return
      }
    }

    dirty.value = false
    ElMessage.success('已保存，客户端下次同步就能看到')
    await dataset.sync(true)
    reset()
  } finally {
    saving.value = false
  }
}

// 从别的页面回来时如果没改过，就跟上最新快照
watch(
  () => dataset.version,
  () => {
    if (!dirty.value) reset()
  }
)

onMounted(() => {
  reset()
})
</script>

<template>
  <section class="content-manage">
    <header class="head">
      <div>
        <h1 class="head__title">文案管理</h1>
        <p class="head__sub">
          改完点「保存全部」；客户端下次同步自动更新，不用发版。
          <span v-if="dirty" class="head__dirty">有未保存的修改</span>
        </p>
      </div>
      <div class="head__actions">
        <el-button :disabled="!canEdit" @click="addSection">新建分组</el-button>
        <el-button :disabled="!dirty" @click="reset">放弃修改</el-button>
        <el-button
          type="primary"
          :disabled="!canEdit || !dirty || network.offline"
          :loading="saving"
          @click="saveAll"
        >
          保存全部
        </el-button>
      </div>
    </header>

    <div v-if="!canEdit" class="card empty">
      <p class="empty__title">没有权限</p>
      <p class="empty__text">文案管理只对超级管理员开放。</p>
    </div>

    <template v-else>
      <p v-if="drafts.length === 0" class="card empty">
        还没有任何文案分组，点右上角「新建分组」开始。
      </p>

      <article v-for="(section, index) in drafts" :key="section.key" class="card group">
        <header class="group__head">
          <el-input
            v-model="section.title"
            class="group__title"
            maxlength="40"
            placeholder="分组标题（必填）"
            @input="markDirty"
          />
          <div class="group__tools">
            <el-button link :disabled="index === 0" @click="moveSection(index, -1)">上移</el-button>
            <el-button link :disabled="index === drafts.length - 1" @click="moveSection(index, 1)">
              下移
            </el-button>
            <el-button link type="danger" @click="removeSection(index)">删除分组</el-button>
          </div>
        </header>

        <el-input
          v-model="section.intro"
          class="group__intro"
          maxlength="200"
          show-word-limit
          placeholder="引言（可选，显示在标题下方）"
          @input="markDirty"
        />

        <ul class="points">
          <li v-for="(point, pointIndex) in section.points" :key="pointIndex" class="point">
            <el-input
              v-model="point.label"
              class="point__label"
              maxlength="12"
              placeholder="标签"
              @input="markDirty"
            />
            <el-input
              v-model="point.body"
              type="textarea"
              :autosize="{ minRows: 1, maxRows: 6 }"
              maxlength="500"
              show-word-limit
              class="point__body"
              placeholder="正文"
              @input="markDirty"
            />
            <div class="point__tools">
              <el-button
                link
                :disabled="pointIndex === 0"
                @click="movePoint(section, pointIndex, -1)"
              >
                ↑
              </el-button>
              <el-button
                link
                :disabled="pointIndex === section.points.length - 1"
                @click="movePoint(section, pointIndex, 1)"
              >
                ↓
              </el-button>
              <el-button link type="danger" @click="removePoint(section, pointIndex)">×</el-button>
            </div>
          </li>
        </ul>

        <el-button class="group__add" @click="addPoint(section)">+ 添加条目</el-button>
      </article>
    </template>
  </section>
</template>

<style scoped>
.content-manage {
  display: flex;
  flex-direction: column;
  gap: 0.875rem;
  padding: clamp(16px, 2.2vw, 28px);
}

.head {
  display: flex;
  gap: 1rem;
  align-items: flex-start;
  justify-content: space-between;
  flex-wrap: wrap;
}

.head__title {
  margin: 0;
  font-size: clamp(1.25rem, 1.6vw, 1.5rem);
  font-weight: 500;
  color: var(--text-1);
}

.head__sub {
  margin: 0.25rem 0 0;
  font-size: var(--font-size-sm);
  color: var(--text-2);
}

.head__dirty {
  margin-left: 0.5rem;
  padding: 0 0.375rem;
  color: var(--warning, #e6a23c);
  background: color-mix(in srgb, var(--warning, #e6a23c) 12%, transparent);
  border-radius: 999px;
}

.head__actions {
  display: flex;
  flex: none;
  gap: 0.5rem;
}

.group {
  padding: clamp(1rem, 1.8vw, 1.5rem);
}

.group__head {
  display: flex;
  gap: 1rem;
  align-items: center;
  justify-content: space-between;
}

.group__title {
  max-width: 24rem;
}

.group__tools {
  display: flex;
  flex: none;
  gap: 0.25rem;
}

.group__intro {
  margin-top: 0.75rem;
}

.points {
  display: flex;
  flex-direction: column;
  gap: 0.5rem;
  margin: 0.875rem 0 0;
  padding: 0;
  list-style: none;
}

.point {
  display: flex;
  gap: 0.5rem;
  align-items: flex-start;
}

.point__label {
  flex: none;
  width: 8rem;
}

.point__body {
  flex: 1;
  min-width: 0;
}

.point__tools {
  display: flex;
  flex: none;
  gap: 0.125rem;
  align-items: center;
  padding-top: 0.25rem;
}

.group__add {
  margin-top: 0.75rem;
}

.empty {
  padding: 2rem;
  text-align: center;
  font-size: var(--font-size-sm);
  color: var(--text-2);
}

.empty__title {
  margin: 0;
  font-size: var(--font-size-lg);
  color: var(--text-1);
}

.empty__text {
  margin: 0.5rem 0 0;
  color: var(--text-2);
}
</style>
