<script setup lang="ts">
/**
 * 登录对话框
 *
 * 用**邮箱 + 密码**（Supabase Auth 的账号体系，旧版是"用户名 + 密码"）。
 * 注册入口在底部：D27 起是**邀请制**，必须填有效邀请码（由管理员发放）。
 *
 * 登录成功后只做两件事：刷新 auth store 的 profile、关窗。
 */
import { reactive, ref, watch } from 'vue'
import { ElMessage, type FormInstance, type FormRules } from 'element-plus'
import RegisterDialog from '@renderer/components/RegisterDialog.vue'
import { useAuthStore, useNetworkStore } from '@renderer/stores'

const props = defineProps<{ visible: boolean }>()

const emit = defineEmits<{
  (event: 'update:visible', value: boolean): void
  (event: 'signed-in'): void
}>()

const auth = useAuthStore()
/** 登录要走 GoTrue，离线禁用（T6.1）；断网时点登录只会白等一圈 */
const network = useNetworkStore()
const formRef = ref<FormInstance>()
const loading = ref(false)

/** 注册对话框：登录框里点「注册新账号」直接换过去 */
const registerVisible = ref(false)

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
      <div class="footer">
        <el-button text type="primary" class="footer__register" @click="registerVisible = true">
          使用邀请码注册
        </el-button>
        <div class="footer__actions">
          <el-button :disabled="loading" @click="close">取消</el-button>
          <el-button type="primary" :loading="loading" :disabled="network.offline" @click="submit">
            登录
          </el-button>
        </div>
      </div>
    </template>
  </el-dialog>

  <!-- 注册成功后：关掉登录框，把 signed-in 往上抛 -->
  <RegisterDialog
    v-model:visible="registerVisible"
    @signed-in="
      () => {
        close()
        emit('signed-in')
      }
    "
  />
</template>

<style scoped>
.footer {
  display: flex;
  gap: 0.75rem;
  align-items: center;
  justify-content: space-between;
  width: 100%;
}

.footer__register {
  padding-left: 0;
  font-size: var(--font-size-sm);
}

.footer__actions {
  display: flex;
  gap: 0.5rem;
}
</style>
