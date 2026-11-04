<script setup lang="ts">
/**
 * 注册对话框（D27 邀请制）
 *
 * 必须填有效邀请码 —— 强制校验在数据库 `handle_new_user` 触发器里，
 * 这里做的是「失焦即时预校验」，让用户不用等一整轮提交才知道码错了。
 *
 * 表单：邀请码 / 邮箱 / 昵称 / 密码 / 确认密码 / 性别 / 图形验证码。
 * 邀请码 / 昵称 / 性别通过 `signUp` 的 metadata 传下去，由触发器写进 profiles（020）。
 *
 * 验证码是**客户端图形码**，只拦低成本脚本（能力边界见 `CaptchaCode.vue` 注释）。
 */
import { reactive, ref, watch } from 'vue'
import { ElMessage, type FormInstance, type FormRules } from 'element-plus'
import { Check, Close, Loading } from '@element-plus/icons-vue'
import CaptchaCode from '@renderer/components/CaptchaCode.vue'
import EmailInput from '@renderer/components/EmailInput.vue'
import { GENDER_LABELS, type Gender } from '@renderer/assets/avatars'
import { useAuthStore, useNetworkStore } from '@renderer/stores'
import { explainSignUpFailure, INVITE_REASON_TEXT, validateInviteCode } from '@shared/api/invite'

const props = defineProps<{ visible: boolean }>()

const emit = defineEmits<{
  (event: 'update:visible', value: boolean): void
  (event: 'signed-in'): void
}>()

const auth = useAuthStore()
/** 注册要走 GoTrue + 邀请码预检，离线禁用（T6.1） */
const network = useNetworkStore()
const formRef = ref<FormInstance>()
const captchaRef = ref<InstanceType<typeof CaptchaCode>>()
const loading = ref(false)
const errorMessage = ref('')

/** 当前验证码（canvas 每次重绘都会推过来） */
const captchaCode = ref('')

/** 邀请码预校验状态：只有 ok 才允许提交 */
const inviteState = ref<'idle' | 'checking' | 'ok' | 'bad'>('idle')
/** 上一次校验过的码（值没变就不重复请求） */
const checkedCode = ref('')

const model = reactive({
  inviteCode: '',
  email: '',
  nickname: '',
  password: '',
  confirmPassword: '',
  gender: 'male' as Gender,
  captcha: ''
})

/**
 * 邀请码校验：必填 → 长度 → 服务端预校验
 *
 * 放在 el-form 的 validator 里（而不是单独的 blur handler），
 * 这样「点注册」时 `validate()` 会一并等它完成，不会出现
 * 「表单通过了但码还没校验完」的竞态。
 */
async function validateInvite(
  _rule: unknown,
  value: string,
  callback: (error?: Error) => void
): Promise<void> {
  const code = String(value ?? '')
    .trim()
    .toUpperCase()
  if (!code) {
    inviteState.value = 'idle'
    callback(new Error('请输入邀请码'))
    return
  }
  if (code.length !== 12) {
    inviteState.value = 'bad'
    callback(new Error('邀请码是 12 位'))
    return
  }
  if (inviteState.value === 'ok' && checkedCode.value === code) {
    callback()
    return
  }

  inviteState.value = 'checking'
  const result = await validateInviteCode(code)
  checkedCode.value = code

  if (result.ok) {
    inviteState.value = 'ok'
    callback()
    return
  }

  inviteState.value = 'bad'
  callback(new Error(INVITE_REASON_TEXT[result.reason === 'ok' ? 'not_found' : result.reason]))
}

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
  // required 只为显示必填星号：真正的校验在 validator 里（async-validator 见到
  // 自定义 validator 就不再跑内置 required 检查）
  inviteCode: [{ required: true, validator: validateInvite, trigger: 'blur' }],
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
    model.inviteCode = ''
    model.email = ''
    model.nickname = ''
    model.password = ''
    model.confirmPassword = ''
    model.gender = 'male'
    model.captcha = ''
    inviteState.value = 'idle'
    checkedCode.value = ''
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
    const result = await auth.signUp(
      model.email,
      model.password,
      model.nickname,
      model.gender,
      model.inviteCode
    )
    if (!result.ok) {
      // supabase-js 会把 500 包成 "Database error saving new user"，
      // 这里再问一次邀请码，把原因还原成中文
      errorMessage.value = await explainSignUpFailure(result.message, model.inviteCode)
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
      <el-form-item label="邀请码" prop="inviteCode">
        <el-input
          v-model="model.inviteCode"
          placeholder="12 位，向邀请你的管理员索取"
          maxlength="12"
          class="invite-input"
          @input="inviteState = 'idle'"
        >
          <template #suffix>
            <el-icon v-if="inviteState === 'checking'" class="spin"><Loading /></el-icon>
            <el-icon v-else-if="inviteState === 'ok'" class="ok"><Check /></el-icon>
            <el-icon v-else-if="inviteState === 'bad'" class="bad"><Close /></el-icon>
          </template>
        </el-input>
      </el-form-item>

      <el-form-item label="邮箱" prop="email">
        <EmailInput v-model="model.email" />
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

    <p class="tip">本程序仅限内部圈子，必须持有效邀请码才能注册；注册即登录，不需要邮箱验证。</p>

    <template #footer>
      <el-button :disabled="loading" @click="close">取消</el-button>
      <el-button type="primary" :loading="loading" :disabled="network.offline" @click="submit">
        注册
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

.captcha-row {
  display: flex;
  gap: 0.75rem;
  align-items: center;
  width: 100%;
}

.captcha-row :deep(.el-input) {
  flex: 1;
}

/* 邀请码是 12 位大写字母数字，拉开字距更好认 */
.invite-input :deep(.el-input__inner) {
  letter-spacing: 0.08em;
  text-transform: uppercase;
}

.ok {
  color: var(--success);
}

.bad {
  color: var(--danger);
}

.spin {
  color: var(--text-3);
  animation: invite-spin 900ms linear infinite;
}

@keyframes invite-spin {
  to {
    transform: rotate(360deg);
  }
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
