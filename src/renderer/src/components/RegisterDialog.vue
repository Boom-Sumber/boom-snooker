<script setup lang="ts">
/**
 * 注册对话框
 *
 * 依据 D13：**开放注册 + 关闭邮箱确认**（T0.1 已在后台关掉），所以注册成功即登录，
 * 不需要用户去点邮件里的确认链接。
 *
 * 表单：邮箱 / 昵称 / 密码 / 确认密码 / 性别 / 图形验证码。
 * 昵称与性别通过 `signUp` 的 metadata 传下去，由 `handle_new_user` 写进 profiles（019）。
 *
 * 验证码是**客户端图形码**，只拦低成本脚本（能力边界见 `CaptchaCode.vue` 注释）。
 */
import { reactive, ref, watch } from 'vue'
import { ElMessage, type FormInstance, type FormRules } from 'element-plus'
import CaptchaCode from '@renderer/components/CaptchaCode.vue'
import { GENDER_LABELS, type Gender } from '@renderer/assets/avatars'
import { useAuthStore } from '@renderer/stores'

const props = defineProps<{ visible: boolean }>()

const emit = defineEmits<{
  (event: 'update:visible', value: boolean): void
  (event: 'signed-in'): void
}>()

const auth = useAuthStore()
const formRef = ref<FormInstance>()
const captchaRef = ref<InstanceType<typeof CaptchaCode>>()
const loading = ref(false)
const errorMessage = ref('')

/** 当前验证码（canvas 每次重绘都会推过来） */
const captchaCode = ref('')

const model = reactive({
  email: '',
  nickname: '',
  password: '',
  confirmPassword: '',
  gender: 'male' as Gender,
  captcha: ''
})

function validateCaptcha(_rule: unknown, value: string, callback: (error?: Error) => void): void {
  if (!value) {
    callback(new Error('请输入验证码'))
    return
  }
  if (value.trim().toUpperCase() !== captchaCode.value) {
    callback(new Error('验证码不对，换一张再试'))
    return
  }
  callback()
}

function validateConfirm(_rule: unknown, value: string, callback: (error?: Error) => void): void {
  if (value !== model.password) callback(new Error('两次输入密码不一致'))
  else callback()
}

const rules: FormRules = {
  email: [
    { required: true, message: '请输入邮箱', trigger: 'blur' },
    { type: 'email', message: '邮箱格式不对', trigger: 'blur' }
  ],
  nickname: [
    { required: true, message: '请输入昵称', trigger: 'blur' },
    { min: 1, max: 24, message: '昵称 1~24 个字', trigger: 'blur' }
  ],
  password: [
    { required: true, message: '请输入密码', trigger: 'blur' },
    { min: 6, message: '密码长度不能小于 6 位', trigger: 'blur' }
  ],
  confirmPassword: [
    { required: true, message: '请再输入一次密码', trigger: 'blur' },
    { validator: validateConfirm, trigger: 'blur' }
  ],
  captcha: [{ validator: validateCaptcha, trigger: 'blur' }]
}

/** 改密码时同步校验确认框 */
watch(
  () => model.password,
  () => {
    if (model.confirmPassword) {
      void formRef.value?.validateField('confirmPassword').catch(() => undefined)
    }
  }
)

/** 每次打开都重置：上一次的邮箱/密码不能留在框里 */
watch(
  () => props.visible,
  (visible) => {
    if (!visible) return
    model.email = ''
    model.nickname = ''
    model.password = ''
    model.confirmPassword = ''
    model.gender = 'male'
    model.captcha = ''
    errorMessage.value = ''
    formRef.value?.clearValidate()
    // 重新画一张：关掉再打开时旧码可能已经"用过"了
    captchaRef.value?.refresh()
  }
)

function close(): void {
  emit('update:visible', false)
}

async function submit(): Promise<void> {
  if (!formRef.value || loading.value) return
  errorMessage.value = ''

  const valid = await formRef.value.validate().catch(() => false)
  if (!valid) {
    // 验证码错就换一张，避免用户对着同一张反复试
    if (model.captcha.trim().toUpperCase() !== captchaCode.value) {
      captchaRef.value?.refresh()
      model.captcha = ''
    }
    return
  }

  loading.value = true
  try {
    const result = await auth.signUp(model.email, model.password, model.nickname, model.gender)
    if (!result.ok) {
      errorMessage.value = result.message
      captchaRef.value?.refresh()
      model.captcha = ''
      return
    }
    ElMessage.success(`注册成功，欢迎 ${auth.nickname}`)
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
    title="注册"
    width="min(28rem, 94vw)"
    :close-on-click-modal="false"
    destroy-on-close
    @update:model-value="emit('update:visible', $event)"
  >
    <p v-if="errorMessage" class="error">{{ errorMessage }}</p>

    <el-form ref="formRef" :model="model" :rules="rules" label-width="5.5rem" @submit.prevent>
      <el-form-item label="邮箱" prop="email">
        <el-input v-model="model.email" placeholder="name@example.com" autocomplete="username" />
      </el-form-item>

      <el-form-item label="昵称" prop="nickname">
        <el-input v-model="model.nickname" placeholder="别人看到的名字，1~24 个字" maxlength="24" />
      </el-form-item>

      <el-form-item label="密码" prop="password">
        <el-input
          v-model="model.password"
          type="password"
          show-password
          placeholder="至少 6 位"
          autocomplete="new-password"
        />
      </el-form-item>

      <el-form-item label="确认密码" prop="confirmPassword">
        <el-input
          v-model="model.confirmPassword"
          type="password"
          show-password
          placeholder="再输入一次密码"
          autocomplete="new-password"
        />
      </el-form-item>

      <el-form-item label="性别" prop="gender">
        <el-radio-group v-model="model.gender">
          <el-radio v-for="(label, value) in GENDER_LABELS" :key="value" :value="value">
            {{ label }}
          </el-radio>
        </el-radio-group>
        <span class="hint">决定默认头像，注册后还能改</span>
      </el-form-item>

      <el-form-item label="验证码" prop="captcha">
        <div class="captcha-row">
          <el-input
            v-model="model.captcha"
            placeholder="输入右侧字符"
            maxlength="4"
            @keyup.enter="submit"
          />
          <CaptchaCode ref="captchaRef" @change="(value: string) => (captchaCode = value)" />
        </div>
      </el-form-item>
    </el-form>

    <p class="tip">注册即登录，不需要邮箱验证；账号仅供内部圈子使用。</p>

    <template #footer>
      <el-button :disabled="loading" @click="close">取消</el-button>
      <el-button type="primary" :loading="loading" @click="submit">注册</el-button>
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

.captcha-row {
  display: flex;
  gap: 0.75rem;
  align-items: center;
  width: 100%;
}

.captcha-row :deep(.el-input) {
  flex: 1;
}

.hint,
.tip {
  font-size: var(--font-size-sm);
  color: var(--text-3);
}

.hint {
  margin-left: 0.75rem;
}

.tip {
  margin: 0;
}
</style>
