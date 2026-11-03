<script setup lang="ts">
/**
 * 进阶条目 新增 / 编辑 对话框
 *
 * 必填只有三项：系列、标题、图片（对应旧版 `ExcelAdvanceTableUI` 的 3 个 `[Required]`），
 * 描述与注解可空。
 *
 * 与彩球表单相同的两条约定：
 *   1. `el-upload` 必须 `:auto-upload="false"` —— 取消时磁盘上不留孤儿图
 *   2. 保存失败要回滚刚传上去的图
 */
import { computed, reactive, ref, watch } from 'vue'
import { ElMessage, type FormInstance, type FormRules, type UploadFile } from 'element-plus'
import { upsertAdvanced } from '@shared/api/advanced'
import { imageUrl } from '@shared/media/url'
import { previewUrl, removeUploadedImages, uploadImage } from '@shared/media/upload'
import { CATEGORY_LABELS } from '@renderer/navigation/menu'
import { useAuthStore, useDatasetStore, type Advanced } from '@renderer/stores'

const props = defineProps<{
  visible: boolean
  /** 传了就是编辑，否则新增 */
  item?: Advanced | null
  /** 新增时的默认系列（跟随列表页当前页签） */
  defaultCategory: string
}>()

const emit = defineEmits<{
  (event: 'update:visible', value: boolean): void
  (event: 'saved'): void
}>()

const auth = useAuthStore()
const dataset = useDatasetStore()
const formRef = ref<FormInstance>()
const saving = ref(false)

const model = reactive({
  id: '',
  category_code: '',
  title: '',
  description: '',
  content: '',
  /** 只用于必填校验（存预览地址），真正提交的是 image.path */
  image: ''
})

const image = reactive<{ file: File | null; preview: string; path: string }>({
  file: null,
  preview: '',
  path: ''
})

/** 关闭时 revoke，避免 objectURL 泄漏 */
let objectUrl = ''

function resetObjectUrl(): void {
  if (objectUrl) URL.revokeObjectURL(objectUrl)
  objectUrl = ''
}

const isEdit = computed(() => Boolean(props.item))

/** 系列选项：优先用字典（有中文名），字典没同步下来时退回本地常量 */
const categories = computed(() => {
  const rows = dataset.dict
    .filter((row) => row.kind === 'category')
    .sort((a, b) => a.sort - b.sort)
    .map((row) => ({ code: row.code, name: row.name_zh }))
  if (rows.length > 0) return rows
  return Object.entries(CATEGORY_LABELS).map(([code, name]) => ({ code, name }))
})

/** 标题"可输入可选"：历史标题（同系列）去重，与旧版 `TitleList` 一致 */
function queryTitles(query: string, callback: (items: { value: string }[]) => void): void {
  const keyword = query.trim()
  const seen = new Set<string>()
  for (const item of dataset.advanced) {
    if (item.category_code === model.category_code && item.title) seen.add(item.title)
  }
  if (model.title) seen.add(model.title)
  const list = [...seen]
    .filter((title) => !keyword || title.includes(keyword))
    .sort((a, b) => a.localeCompare(b, 'zh-Hans-CN'))
  callback(list.map((value) => ({ value })))
}

const rules: FormRules = {
  category_code: [{ required: true, message: '请选择类型', trigger: 'change' }],
  title: [{ required: true, message: '请选择/定义标题', trigger: 'change' }],
  image: [{ required: true, message: '请选择图片', trigger: 'change' }]
}

watch(
  () => props.visible,
  (visible) => {
    if (!visible) {
      resetObjectUrl()
      return
    }
    const item = props.item
    model.id = item?.id ?? ''
    model.category_code = item?.category_code ?? props.defaultCategory
    model.title = item?.title ?? ''
    model.description = item?.description ?? ''
    model.content = item?.content ?? ''

    const path = item?.image ?? ''
    image.file = null
    image.preview = path ? imageUrl(path) : ''
    image.path = path
    model.image = path ? imageUrl(path) : ''

    formRef.value?.clearValidate()
  }
)

const ACCEPT_TYPES = ['image/png', 'image/jpeg', 'image/webp']
const ACCEPT_ATTR = ACCEPT_TYPES.join(',')
const MAX_SIZE_MB = 5

function onPick(uploadFile: UploadFile): void {
  const raw = uploadFile.raw
  if (!raw) return

  if (!ACCEPT_TYPES.includes(raw.type)) {
    ElMessage.warning('只支持 JPG / PNG / WebP 图片')
    return
  }
  if (raw.size > MAX_SIZE_MB * 1024 * 1024) {
    ElMessage.warning(
      `图片不能超过 ${MAX_SIZE_MB} MB（当前 ${(raw.size / 1024 / 1024).toFixed(1)} MB）`
    )
    return
  }

  resetObjectUrl()
  objectUrl = previewUrl(raw)
  // 整对象赋值，理由见 BallFormDialog.onPick 的注释（嵌套字段改在部分时序下不回显）
  image.file = raw
  image.preview = objectUrl
  model.image = objectUrl
  void formRef.value?.validateField('image').catch(() => undefined)
}

function close(): void {
  emit('update:visible', false)
}

async function save(): Promise<void> {
  if (!formRef.value) return
  const valid = await formRef.value.validate().catch(() => false)
  if (!valid) return

  saving.value = true
  // 只有「本次真新建」的路径才进这里：命中已有对象时删了会让别的记录裂图（T7.1）
  const createdPaths: string[] = []

  try {
    let path = image.path
    if (image.file) {
      const uploaded = await uploadImage(image.file, 'advanced')
      if (uploaded.created) createdPaths.push(uploaded.path)
      path = uploaded.path
    }

    const result = await upsertAdvanced(
      {
        id: model.id || undefined,
        category_code: model.category_code,
        title: model.title,
        description: model.description,
        content: model.content,
        image: path
      },
      dataset.version
    )

    if (!result.ok) {
      await removeUploadedImages(createdPaths)
      if (result.conflict) {
        void dataset.sync(true)
        ElMessage.warning(result.message ?? '数据已被其他人更新')
      } else {
        ElMessage.error(result.message ?? '保存失败')
      }
      return
    }

    // D32：管理员提交也要审核 —— 管理员的内容由超管审，高级用户的由邀请他的管理员审
    ElMessage.success(auth.isAdmin ? '已提交，等待超级管理员审核' : '已提交，等待管理员审核')
    emit('saved')
    close()
  } catch (error) {
    await removeUploadedImages(createdPaths)
    ElMessage.error(error instanceof Error ? error.message : '保存失败')
  } finally {
    saving.value = false
  }
}
</script>

<template>
  <el-dialog
    :model-value="visible"
    :title="isEdit ? '编辑进阶条目' : '新增进阶条目'"
    width="min(42rem, 92vw)"
    top="6vh"
    :close-on-click-modal="false"
    destroy-on-close
    @update:model-value="emit('update:visible', $event)"
  >
    <el-form
      ref="formRef"
      :model="model"
      :rules="rules"
      label-width="5.5rem"
      label-position="right"
    >
      <el-form-item label="类型" prop="category_code">
        <el-select v-model="model.category_code" placeholder="选择类型" class="field">
          <el-option
            v-for="option in categories"
            :key="option.code"
            :label="option.name"
            :value="option.code"
          />
        </el-select>
      </el-form-item>

      <el-form-item label="标题" prop="title">
        <el-autocomplete
          v-model="model.title"
          class="field"
          placeholder="选择或直接输入新标题"
          clearable
          :fetch-suggestions="queryTitles"
        />
      </el-form-item>

      <el-form-item label="描述" prop="description">
        <el-input
          v-model="model.description"
          type="textarea"
          :rows="2"
          placeholder="一句话说明这条打法（可空）"
        />
      </el-form-item>

      <el-form-item label="注解" prop="content">
        <el-input
          v-model="model.content"
          type="textarea"
          :rows="5"
          placeholder="详细说明及注意事项（可空）"
        />
      </el-form-item>

      <el-form-item label="图片" prop="image">
        <div class="image-row">
          <div class="image-preview" :class="{ 'image-preview--empty': !image.preview }">
            <img v-if="image.preview" :src="image.preview" alt="进阶图片" />
            <span v-else>未选择</span>
          </div>

          <el-upload
            :auto-upload="false"
            :show-file-list="false"
            :accept="ACCEPT_ATTR"
            :on-change="onPick"
          >
            <el-button>{{ image.preview ? '重新选择' : '选择图片' }}</el-button>
          </el-upload>

          <span class="image-hint"
            >支持 JPG / PNG / WebP，单张 ≤ {{ MAX_SIZE_MB }} MB，保存时自动转 WebP</span
          >
        </div>
      </el-form-item>
    </el-form>

    <template #footer>
      <el-button :disabled="saving" @click="close">取消</el-button>
      <el-button type="primary" :loading="saving" @click="save">保存</el-button>
    </template>
  </el-dialog>
</template>

<style scoped>
.field {
  width: 100%;
}

.image-row {
  display: flex;
  flex-wrap: wrap;
  gap: 0.75rem;
  align-items: center;
}

.image-preview {
  display: grid;
  place-items: center;
  width: 5.5rem;
  height: 5.5rem;
  overflow: hidden;
  background: var(--image-frame-bg);
  border: 1px solid var(--border);
  border-radius: var(--radius-md);
}

.image-preview img {
  width: 100%;
  height: 100%;
  object-fit: contain;
}

.image-preview--empty {
  font-size: var(--font-size-sm);
  color: var(--text-3);
}

.image-hint {
  font-size: var(--font-size-sm);
  color: var(--text-3);
}
</style>
