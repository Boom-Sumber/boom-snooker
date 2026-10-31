<script setup lang="ts">
/**
 * 登录对话框
 *
 * 用**邮箱 + 密码**（Supabase Auth 的账号体系，旧版是"用户名 + 密码"）。
 * 不提供注册入口：D13 虽然是开放注册，但用户规模是内部圈子，
 * 账号由管理员在 Supabase 后台开（`docs/01` 阶段 0 的记录）。
 *
 * 登录成功后只做两件事：刷新 auth store 的 profile、关窗。
 */
import { reactive, ref, watch } from 'vue'
import { ElMessage, type FormInstance, type FormRules } from 'element-plus'
import { useAuthStore } from '@renderer/stores'

const props = defineProps<{ visible: boolean }>()

const emit = defineEmits<{
  (event: 'update:visible', value: boolean): void
  (event: 'signed-in'): void
}>()

const auth = useAuthStore()
const formRef = ref<FormInstance>()
const loading = ref(false)

const model = reactive({ email: '', password: '' })

const rules: FormRules = {
  email: [
    { required: true, message: '请输入邮箱', trigger: 'blur' },
    { type: 'email', message: '邮箱格式不对', trigger: 'blur' }
  ],
  password: [{ required: true, message: '请输入密码', trigger: 'blur' }]
}

/** 每次打开都清空，避免上次的密码留在框里 */
watch(
  () => props.visible,
  (visible) => {
    if (!visible) return
    model.email = ''
    model.password = ''
    formRef.value?.clearValidate()
  }
)

function close(): void {
  emit('update:visible', false)
}

async function submit(): Promise<void> {
  if (!formRef.value || loading.value) return
  const valid = await formRef.value.validate().catch(() => false)
  if (!valid) return

  loading.value = true
  try {
    const result = await auth.signIn(model.email, model.password)
    if (!result.ok) {
      ElMessage.error(result.message)
      return
    }
    ElMessage.success(`欢迎回来，${auth.nickname || model.email}`)
    emit('signed-in')
    close()
  } finally {
    loading.value = false
  }
}
</script>

<template>
  <el-dialog
    :model-value="visible"
    title="登录"
    width="min(24rem, 92vw)"
    :close-on-click-modal="false"
    destroy-on-close
    @update:model-value="emit('update:visible', $event)"
  >
    <el-form ref="formRef" :model="model" :rules="rules" label-width="4rem" @submit.prevent>
      <el-form-item label="邮箱" prop="email">
        <el-input
          v-model="model.email"
          placeholder="name@example.com"
          autocomplete="username"
          @keyup.enter="submit"
        />
      </el-form-item>

      <el-form-item label="密码" prop="password">
        <el-input
          v-model="model.password"
          type="password"
          show-password
          placeholder="请输入密码"
          autocomplete="current-password"
          @keyup.enter="submit"
        />
      </el-form-item>
    </el-form>

    <template #footer>
      <el-button :disabled="loading" @click="close">取消</el-button>
      <el-button type="primary" :loading="loading" @click="submit">登录</el-button>
    </template>
  </el-dialog>
</template>
