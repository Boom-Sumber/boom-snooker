<script setup lang="ts">
/**
 * 编辑个人资料（昵称 / 性别 / 头像）
 *
 * 头像只在内置的几张里选（`assets/avatars`），库里存 key 而不是 URL：
 * 不占 Storage、不产生流量，也就没有开放上传带来的权限问题。
 *
 * 性别决定**默认**头像：没手动挑过头像时，切换性别会跟着换；
 * 手动挑过就保持用户的选择（`touched` 标记）。
 */
import { computed, reactive, ref, watch } from 'vue'
import { ElMessage, type FormInstance, type FormRules } from 'element-plus'
import {
  AVATARS,
  DEFAULT_AVATAR,
  GENDER_LABELS,
  normalizeGender,
  resolveAvatar,
  type AvatarKey,
  type Gender
} from '@renderer/assets/avatars'
import { useAuthStore } from '@renderer/stores'

const props = defineProps<{ visible: boolean }>()

const emit = defineEmits<{
  (event: 'update:visible', value: boolean): void
  (event: 'saved'): void
}>()

const auth = useAuthStore()
const formRef = ref<FormInstance>()
const loading = ref(false)
const errorMessage = ref('')

const model = reactive({
  nickname: '',
  gender: 'male' as Gender,
  avatar: 'avatar-boy' as AvatarKey
})

/** 用户是否手动挑过头像：没挑过就让性别带着走 */
let avatarTouched = false

const previewSrc = computed(() => resolveAvatar(model.avatar, model.gender))

const rules: FormRules = {
  nickname: [
    { required: true, message: '请输入昵称', trigger: 'blur' },
    { min: 1, max: 24, message: '昵称 1~24 个字', trigger: 'blur' }
  ]
}

watch(
  () => props.visible,
  (visible) => {
    if (!visible) return
    const profile = auth.profile
    model.nickname = profile?.nickname ?? ''
    model.gender = normalizeGender(profile?.gender)
    model.avatar = (profile?.avatar as AvatarKey) || DEFAULT_AVATAR[model.gender]
    avatarTouched = Boolean(profile?.avatar)
    errorMessage.value = ''
    formRef.value?.clearValidate()
  }
)

function onGenderChange(value: string | number | boolean | undefined): void {
  const next = normalizeGender(String(value))
  model.gender = next
  if (!avatarTouched) model.avatar = DEFAULT_AVATAR[next]
}

function pickAvatar(key: AvatarKey): void {
  model.avatar = key
  avatarTouched = true
}

function close(): void {
  emit('update:visible', false)
}

async function save(): Promise<void> {
  if (!formRef.value || loading.value) return
  errorMessage.value = ''

  const valid = await formRef.value.validate().catch(() => false)
  if (!valid) return

  loading.value = true
  try {
    const result = await auth.updateProfile({
      nickname: model.nickname.trim(),
      gender: model.gender,
      avatar: model.avatar
    })
    if (!result.ok) {
      errorMessage.value = result.message
      return
    }
    ElMessage.success('资料已更新')
    emit('saved')
    close()
  } finally {
    loading.value = false
  }
}
</script>

<template>
  <el-dialog
    :model-value="visible"
    title="编辑资料"
    width="min(30rem, 94vw)"
    :close-on-click-modal="false"
    destroy-on-close
    @update:model-value="emit('update:visible', $event)"
  >
    <p v-if="errorMessage" class="error">{{ errorMessage }}</p>

    <el-form ref="formRef" :model="model" :rules="rules" label-width="5.5rem" @submit.prevent>
      <el-form-item label="昵称" prop="nickname">
        <el-input
          v-model="model.nickname"
          placeholder="1~24 个字"
          maxlength="24"
          show-word-limit
          @keyup.enter="save"
        />
      </el-form-item>

      <el-form-item label="性别" prop="gender">
        <el-radio-group :model-value="model.gender" @change="onGenderChange">
          <el-radio v-for="(label, value) in GENDER_LABELS" :key="value" :value="value">
            {{ label }}
          </el-radio>
        </el-radio-group>
      </el-form-item>

      <el-form-item label="头像" prop="avatar">
        <div class="avatars">
          <button
            v-for="item in AVATARS"
            :key="item.key"
            class="avatar-option"
            :class="{ 'avatar-option--active': model.avatar === item.key }"
            type="button"
            :title="item.label"
            @click="pickAvatar(item.key)"
          >
            <img :src="item.src" :alt="item.label" />
          </button>

          <div class="preview">
            <el-avatar :size="48" :src="previewSrc" />
            <span>当前效果</span>
          </div>
        </div>
      </el-form-item>
    </el-form>

    <template #footer>
      <el-button :disabled="loading" @click="close">取消</el-button>
      <el-button type="primary" :loading="loading" @click="save">保存</el-button>
    </template>
  </el-dialog>
</template>

<style scoped>
.error {
  margin: 0 0 0.75rem;
  padding: 0.5rem 0.75rem;
  font-size: var(--font-size-sm);
  color: var(--danger);
  background: color-mix(in srgb, var(--danger) 10%, transparent);
  border-radius: var(--radius-sm);
}

.avatars {
  display: flex;
  flex-wrap: wrap;
  gap: 0.75rem;
  align-items: center;
}

.avatar-option {
  width: 3.5rem;
  height: 3.5rem;
  padding: 0;
  overflow: hidden;
  cursor: pointer;
  background: var(--surface-2);
  border: 2px solid transparent;
  border-radius: 50%;
  transition:
    border-color var(--transition-fast),
    transform var(--transition-fast);
}

.avatar-option img {
  width: 100%;
  height: 100%;
  object-fit: cover;
}

.avatar-option:hover {
  transform: translateY(-1px);
}

.avatar-option--active {
  border-color: var(--primary);
}

.preview {
  display: flex;
  gap: 0.5rem;
  align-items: center;
  margin-left: 0.5rem;
  font-size: var(--font-size-sm);
  color: var(--text-3);
}
</style>
