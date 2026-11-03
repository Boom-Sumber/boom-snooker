<script setup lang="ts">
/**
 * 修改密码对话框
 *
 * 四条校验规则与旧版 `UpdatePasswordViewModel` 一一对应：
 *   1. 三项都不能为空
 *   2. 新密码长度 ≥ 6
 *   3. 两次新密码必须一致
 *   4. 新旧密码不能相同
 *
 * 第五条「旧密码是否真的对」只能由服务端判断（`auth.changePassword` 会先用旧密码
 * 重新登录验一次），失败时把中文错误显示在表单上方。
 *
 * 改密成功 → store 里直接强制登出（旧版行为），用户要用新密码重新登录。
 */
import { reactive, ref, watch } from 'vue'
import { ElMessage, type FormInstance, type FormRules } from 'element-plus'
import { useAuthStore, useNetworkStore } from '@renderer/stores'

const props = defineProps<{ visible: boolean }>()

const emit = defineEmits<{ (event: 'update:visible', value: boolean): void }>()

const auth = useAuthStore()
/** 改密要走 GoTrue，离线禁用（T6.1） */
const network = useNetworkStore()
const formRef = ref<FormInstance>()
const loading = ref(false)
const errorMessage = ref('')

const model = reactive({ oldPassword: '', newPassword: '', confirmPassword: '' })

/** 自定义规则：新密码不能和旧密码相同 */
function validateDifferent(_rule: unknown, value: string, callback: (error?: Error) => void): void {
  if (value && value === model.oldPassword) callback(new Error('新旧密码不能相同'))
  else callback()
}

/** 自定义规则：两次输入必须一致 */
function validateConfirm(_rule: unknown, value: string, callback: (error?: Error) => void): void {
  if (value !== model.newPassword) callback(new Error('两次输入密码不一致'))
  else callback()
}

const rules: FormRules = {
  oldPassword: [{ required: true, message: '请输入旧密码', trigger: 'blur' }],
  newPassword: [
    { required: true, message: '请输入新密码', trigger: 'blur' },
    { min: 6, message: '密码长度不能小于 6 位', trigger: 'blur' },
    { validator: validateDifferent, trigger: 'blur' }
  ],
  confirmPassword: [
    { required: true, message: '请再输入一次新密码', trigger: 'blur' },
    { validator: validateConfirm, trigger: 'blur' }
  ]
}

/** 改了新密码要重算"两次一致"，否则确认框的错误提示会停在旧状态 */
watch(
  () => model.newPassword,
  () => {
    if (model.confirmPassword) {
      void formRef.value?.validateField('confirmPassword').catch(() => undefined)
    }
  }
)

watch(
  () => props.visible,
  (visible) => {
    if (!visible) return
    model.oldPassword = ''
    model.newPassword = ''
    model.confirmPassword = ''
    errorMessage.value = ''
    formRef.value?.clearValidate()
  }
)

function close(): void {
  emit('update:visible', false)
}

async function submit(): Promise<void> {
  if (!formRef.value || loading.value) return
  errorMessage.value = ''

  const valid = await formRef.value.validate().catch(() => false)
  if (!valid) return

  loading.value = true
  try {
    const result = await auth.changePassword(model.oldPassword, model.newPassword)
    if (!result.ok) {
      errorMessage.value = result.message
      return
    }
    ElMessage.success('密码修改完成，请重新登录')
    close()
  } finally {
    loading.value = false
  }
}
</script>

<template>
  <el-dialog
    :model-value="visible"
    title="修改密码"
    width="min(26rem, 92vw)"
    :close-on-click-modal="false"
    destroy-on-close
    @update:model-value="emit('update:visible', $event)"
  >
    <p v-if="errorMessage" class="error">{{ errorMessage }}</p>

    <el-form ref="formRef" :model="model" :rules="rules" label-width="6.5rem" @submit.prevent>
      <el-form-item label="旧密码" prop="oldPassword">
        <el-input
          v-model="model.oldPassword"
          type="password"
          show-password
          placeholder="当前使用的密码"
          autocomplete="current-password"
        />
      </el-form-item>

      <el-form-item label="新密码" prop="newPassword">
        <el-input
          v-model="model.newPassword"
          type="password"
          show-password
          placeholder="至少 6 位，且不能和旧密码相同"
          autocomplete="new-password"
        />
      </el-form-item>

      <el-form-item label="确认新密码" prop="confirmPassword">
        <el-input
          v-model="model.confirmPassword"
          type="password"
          show-password
          placeholder="再输入一次新密码"
          autocomplete="new-password"
          @keyup.enter="submit"
        />
      </el-form-item>
    </el-form>

    <p class="hint">改密成功后会自动登出，请用新密码重新登录。</p>

    <template #footer>
      <el-button :disabled="loading" @click="close">取消</el-button>
      <el-button type="primary" :loading="loading" :disabled="network.offline" @click="submit">
        确认修改
      </el-button>
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

.hint {
  margin: 0;
  font-size: var(--font-size-sm);
  color: var(--text-3);
}
</style>
