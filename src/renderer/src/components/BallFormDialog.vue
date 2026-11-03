<script setup lang="ts">
/**
 * 彩球打法 新增 / 编辑 对话框
 *
 * 11 个必填项与旧版 WPF 一一对应（`ExcelColorBallToUI` 上的 `[Required]`）：
 * 彩球、袋口、进球方式、力度、瞄准方法、低杆补偿、高杆补偿、补充说明、
 * 击球点图、蓝点图、路线图。
 *
 * 两个关键行为：
 *   1. **选图不上传**：`el-upload` 全部 `:auto-upload="false"`，点保存时才转 WebP 上传。
 *      用户点取消 → 磁盘上不会多出任何文件（旧版"取消留孤儿图"的坑）
 *   2. **保存失败要回滚已上传的图**：先传图再调 RPC，RPC 失败时把刚传的删掉，
 *      否则每失败一次就留下 3 张没人引用的 WebP
 */
import { computed, reactive, ref, watch } from 'vue'
import { ElMessage, type FormInstance, type FormRules, type UploadFile } from 'element-plus'
import { upsertBall } from '@shared/api/balls'
import { imageUrl } from '@shared/media/url'
import { previewUrl, removeUploadedImages, uploadImage } from '@shared/media/upload'
import { useAuthStore, useDatasetStore, type Ball } from '@renderer/stores'

const props = defineProps<{
  visible: boolean
  /** 传了就是编辑，否则新增 */
  ball?: Ball | null
  /** 新增时的默认彩球 / 袋口（跟随列表页当前选择） */
  defaultColor: string
  defaultPocket: string
}>()

const emit = defineEmits<{
  (event: 'update:visible', value: boolean): void
  (event: 'saved'): void
}>()

const auth = useAuthStore()
const dataset = useDatasetStore()
const formRef = ref<FormInstance>()
const saving = ref(false)

type Slot = 'impact' | 'blue' | 'route'

const IMAGE_SLOTS: {
  key: Slot
  label: string
  field: 'impact_image' | 'blue_image' | 'route_image'
}[] = [
  { key: 'impact', label: '击球点图片', field: 'impact_image' },
  { key: 'blue', label: '蓝点图片', field: 'blue_image' },
  { key: 'route', label: '路线图片', field: 'route_image' }
]

/**
 * 表单模型
 *
 * `impact` / `blue` / `route` 三个字段只用于 `el-form` 的必填校验（存预览地址），
 * 真正提交的是 `images[*].path`。
 */
const model = reactive({
  id: '',
  color_code: '',
  pocket_code: '',
  method: '',
  strength_code: '',
  sight: '',
  low_comp: '',
  high_comp: '',
  remark: '',
  impact: '',
  blue: '',
  route: ''
})

const images = reactive<Record<Slot, { file: File | null; preview: string; path: string }>>({
  impact: { file: null, preview: '', path: '' },
  blue: { file: null, preview: '', path: '' },
  route: { file: null, preview: '', path: '' }
})

/** 需要在关闭/重开时 revoke 的 objectURL，避免内存泄漏 */
let objectUrls: string[] = []

function resetObjectUrls(): void {
  for (const url of objectUrls) URL.revokeObjectURL(url)
  objectUrls = []
}

const isEdit = computed(() => Boolean(props.ball))

const colors = computed(() =>
  dataset.dict
    .filter((row) => row.kind === 'color')
    .sort((a, b) => a.sort - b.sort)
    .map((row) => ({ code: row.code, name: row.name_zh }))
)

const pockets = computed(() =>
  dataset.dict
    .filter((row) => row.kind === 'pocket')
    .sort((a, b) => a.sort - b.sort)
    .map((row) => ({ code: row.code, name: row.name_zh }))
)

const strengths = computed(() =>
  dataset.dict
    .filter((row) => row.kind === 'strength')
    .sort((a, b) => a.sort - b.sort)
    .map((row) => ({ code: row.code, name: row.name_zh }))
)

/** 进袋方式：历史值去重（同袋口下所有彩球出现过的），允许自定义输入 */
const methodOptions = computed(() => {
  const seen = new Set<string>()
  for (const ball of dataset.balls) {
    if (ball.pocket_code === model.pocket_code && ball.method) seen.add(ball.method)
  }
  if (model.method) seen.add(model.method)
  return [...seen].sort((a, b) => a.localeCompare(b, 'zh-Hans-CN'))
})

/**
 * 进袋方式用 `el-autocomplete` 而不是 `el-select + allow-create`
 *
 * 原因（用户实测反馈）：`allow-create` 下输入的自定义值**只有按回车**才会写进 model，
 * 直接按 Tab / 点别的输入框，输入内容会被清掉。
 * `el-autocomplete` 的 v-model 直接绑输入框文本，失焦天然保留 —— 语义就是"可输入可选"。
 */
function queryMethods(query: string, callback: (items: { value: string }[]) => void): void {
  const keyword = query.trim()
  const list = methodOptions.value.filter((item) => !keyword || item.includes(keyword))
  callback(list.map((value) => ({ value })))
}

const rules: FormRules = {
  color_code: [{ required: true, message: '请选择彩球', trigger: 'change' }],
  pocket_code: [{ required: true, message: '请选择袋口', trigger: 'change' }],
  method: [{ required: true, message: '请选择进球方式', trigger: 'change' }],
  strength_code: [{ required: true, message: '请选择击球力度', trigger: 'change' }],
  sight: [{ required: true, message: '瞄准方法输入不能为空', trigger: 'blur' }],
  low_comp: [{ required: true, message: '低杆补偿输入不能为空', trigger: 'blur' }],
  high_comp: [{ required: true, message: '高杆补偿输入不能为空', trigger: 'blur' }],
  remark: [{ required: true, message: '补充说明输入不能为空', trigger: 'blur' }],
  impact: [{ required: true, message: '请选择击球点图片', trigger: 'change' }],
  blue: [{ required: true, message: '请选择蓝点图片', trigger: 'change' }],
  route: [{ required: true, message: '请选择路线图片', trigger: 'change' }]
}

/** 打开时按 ball / 默认值填表 */
watch(
  () => props.visible,
  (visible) => {
    if (!visible) {
      resetObjectUrls()
      return
    }
    const ball = props.ball
    model.id = ball?.id ?? ''
    model.color_code = ball?.color_code ?? props.defaultColor
    model.pocket_code = ball?.pocket_code ?? props.defaultPocket
    model.method = ball?.method ?? ''
    model.strength_code = ball?.strength_code ?? ''
    model.sight = ball?.sight ?? ''
    model.low_comp = ball?.low_comp ?? ''
    model.high_comp = ball?.high_comp ?? ''
    model.remark = ball?.remark ?? ''

    for (const slot of IMAGE_SLOTS) {
      const path = ball?.[slot.field] ?? ''
      images[slot.key] = { file: null, preview: path ? imageUrl(path) : '', path }
      model[slot.key] = path ? imageUrl(path) : ''
    }
    formRef.value?.clearValidate()
  }
)

/** 允许上传的格式（浏览器 canvas 都能解出来） */
const ACCEPT_TYPES = ['image/png', 'image/jpeg', 'image/webp']
const ACCEPT_ATTR = ACCEPT_TYPES.join(',')
/** 单张上限：源图多是几十 KB 的 PNG，5 MB 足够；再大转 WebP 也慢 */
const MAX_SIZE_MB = 5

/** 选图：只记文件和预览，**不上传** */
function onPick(slot: Slot, uploadFile: UploadFile): void {
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

  const url = previewUrl(raw)
  objectUrls.push(url)
  // ⚠️ 整对象替换而不是改字段：`images` 是 reactive 的嵌套对象，
  // 直接改 `.preview` 在部分时序下（同一 tick 内连续赋值 + 表单校验触发的重渲染）
  // 会让预览框停留在"未选择"。换一个新对象一定触发依赖，肉眼可见地即时。
  images[slot] = { file: raw, preview: url, path: images[slot].path }
  model[slot] = url // 让必填校验通过
  void formRef.value?.validateField(slot).catch(() => undefined)
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
    // 1. 只上传"这次新选的"图；没换的沿用原路径
    const paths: Record<Slot, string> = {
      impact: images.impact.path,
      blue: images.blue.path,
      route: images.route.path
    }
    for (const slot of IMAGE_SLOTS) {
      const file = images[slot.key].file
      if (file) {
        const image = await uploadImage(file)
        if (image.created) createdPaths.push(image.path)
        paths[slot.key] = image.path
      }
    }

    // 2. 走 RPC（带乐观锁）
    const result = await upsertBall(
      {
        id: model.id || undefined,
        color_code: model.color_code,
        pocket_code: model.pocket_code,
        method: model.method,
        strength_code: model.strength_code,
        sight: model.sight,
        low_comp: model.low_comp,
        high_comp: model.high_comp,
        remark: model.remark,
        impact_image: paths.impact,
        blue_image: paths.blue,
        route_image: paths.route
      },
      dataset.version
    )

    if (!result.ok) {
      // 3. 失败回滚：把刚传上去的图删掉，不留孤儿
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
    const message = error instanceof Error ? error.message : '保存失败'
    ElMessage.error(message)
  } finally {
    saving.value = false
  }
}
</script>

<template>
  <el-dialog
    :model-value="visible"
    :title="isEdit ? '编辑彩球打法' : '新增彩球打法'"
    width="min(52rem, 92vw)"
    top="6vh"
    :close-on-click-modal="false"
    destroy-on-close
    @update:model-value="emit('update:visible', $event)"
  >
    <el-form
      ref="formRef"
      :model="model"
      :rules="rules"
      label-width="6.5rem"
      label-position="right"
    >
      <div class="grid">
        <el-form-item label="彩球" prop="color_code">
          <el-select v-model="model.color_code" placeholder="请选择彩球" class="field">
            <el-option
              v-for="item in colors"
              :key="item.code"
              :label="item.name"
              :value="item.code"
            />
          </el-select>
        </el-form-item>

        <el-form-item label="袋口" prop="pocket_code">
          <el-select v-model="model.pocket_code" placeholder="请选择袋口" class="field">
            <el-option
              v-for="item in pockets"
              :key="item.code"
              :label="item.name"
              :value="item.code"
            />
          </el-select>
        </el-form-item>

        <el-form-item label="进球方式" prop="method">
          <el-autocomplete
            v-model="model.method"
            class="field"
            placeholder="选择或直接输入新的方式"
            clearable
            :fetch-suggestions="queryMethods"
          />
        </el-form-item>

        <el-form-item label="击球力度" prop="strength_code">
          <el-select v-model="model.strength_code" placeholder="请选择击球力度" class="field">
            <el-option
              v-for="item in strengths"
              :key="item.code"
              :label="item.name"
              :value="item.code"
            />
          </el-select>
        </el-form-item>
      </div>

      <el-form-item label="瞄准方法" prop="sight">
        <el-input
          v-model="model.sight"
          type="textarea"
          :rows="2"
          placeholder="例如：光圈套住目标球…"
        />
      </el-form-item>

      <div class="grid">
        <el-form-item label="低杆补偿" prop="low_comp">
          <el-input
            v-model="model.low_comp"
            type="textarea"
            :rows="2"
            placeholder="低杆时蓝点补偿"
          />
        </el-form-item>
        <el-form-item label="高杆补偿" prop="high_comp">
          <el-input
            v-model="model.high_comp"
            type="textarea"
            :rows="2"
            placeholder="高杆时蓝点补偿"
          />
        </el-form-item>
      </div>

      <el-form-item label="补充说明" prop="remark">
        <el-input v-model="model.remark" type="textarea" :rows="2" placeholder="其他注意事项" />
      </el-form-item>

      <el-form-item
        v-for="slot in IMAGE_SLOTS"
        :key="slot.key"
        :label="slot.label"
        :prop="slot.key"
        class="image-item"
      >
        <div class="image-row">
          <div class="image-preview" :class="{ 'image-preview--empty': !images[slot.key].preview }">
            <img
              v-if="images[slot.key].preview"
              :src="images[slot.key].preview"
              :alt="slot.label"
            />
            <span v-else>未选择</span>
          </div>

          <el-upload
            :auto-upload="false"
            :show-file-list="false"
            :accept="ACCEPT_ATTR"
            :on-change="(file: UploadFile) => onPick(slot.key, file)"
          >
            <el-button>{{ images[slot.key].preview ? '重新选择' : '选择图片' }}</el-button>
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
.grid {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 0 1rem;
}

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
  /* 路线图/击球点图多为白底，统一白衬，暗色下不刺眼 */
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

.image-item {
  margin-bottom: 0.75rem;
}

@media (max-width: 60rem) {
  .grid {
    grid-template-columns: 1fr;
  }
}
</style>
