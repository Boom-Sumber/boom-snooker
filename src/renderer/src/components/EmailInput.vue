<script setup lang="ts">
/**
 * 邮箱输入框（带后缀联想）
 *
 * 只做一件事：敲到 `abc@` 或 `abc@q` 时，把常见邮箱域名补全成候选，
 * 省掉手打 `qq.com` 这类高频后缀。**不做校验** —— 格式校验仍在 el-form 的 rules 里。
 *
 * 为什么用 el-autocomplete 而不是自己拼下拉：上下键选择、点选、点外部关闭、
 * 弹层 teleport 到 body 避免被 el-dialog 的 overflow 裁掉，这些它都实现了。
 *
 * 注意：回车在输入框里是「选中联想项」，不是「提交表单」。
 * 所以登录框只把 `@keyup.enter` 挂在密码框上（避免"刚选中就被提交"）。
 */
import type { AutocompleteFetchSuggestions } from 'element-plus'

const props = withDefaults(
  defineProps<{
    placeholder?: string
    /** 交给系统密码管理器：登录/注册都填 username，让它记住整串账号 */
    autocomplete?: string
  }>(),
  { placeholder: 'name@example.com', autocomplete: 'username' }
)

const model = defineModel<string>({ default: '' })

/**
 * 常见后缀，按使用频率排（qq 系在前，国内用户占绝大多数）
 *
 * 不放 `vip.qq.com` 这类：候选一多，下拉就要滚动，反而不如手打。
 */
const DOMAINS = [
  'qq.com',
  '163.com',
  '126.com',
  'foxmail.com',
  '139.com',
  'outlook.com',
  'gmail.com',
  'sina.com',
  'hotmail.com',
  'icloud.com'
]

/** 下拉最多显示几条：再多了就要滚动，联想的意义就没了 */
const MAX_ITEMS = 6

interface EmailSuggestion {
  /** 补全后的完整邮箱 */
  value: string
  /** 前多少个字符是用户已经打出来的（模板里用来分色） */
  typed: number
}

const fetchSuggestions: AutocompleteFetchSuggestions = (query, callback) => {
  const raw = String(query ?? '')
  const at = raw.indexOf('@')
  const local = at === -1 ? raw : raw.slice(0, at)
  const domainPart = at === -1 ? '' : raw.slice(at + 1)
  const typedDomain = domainPart.toLowerCase()

  // 本地部分为空（只打了 @）、或已经出现第二个 @ → 没什么可补的
  if (!local.trim() || domainPart.includes('@')) {
    callback([])
    return
  }

  const items: EmailSuggestion[] = DOMAINS.filter(
    // 已经完整打完的域名不再提示，否则下拉里会出现一条和输入框一模一样的内容
    (domain) => domain.startsWith(typedDomain) && domain !== typedDomain
  )
    .slice(0, MAX_ITEMS)
    .map((domain) => ({
      value: `${local}@${domain}`,
      typed: local.length + 1 + typedDomain.length
    }))

  callback(items)
}
</script>

<template>
  <el-autocomplete
    v-model="model"
    class="email-input"
    :fetch-suggestions="fetchSuggestions"
    :placeholder="props.placeholder"
    :autocomplete="props.autocomplete"
    :trigger-on-focus="true"
    :highlight-first-item="true"
    :debounce="80"
  >
    <!-- 已输入部分正常色、补全部分弱色，一眼能看出哪几个字是自己打的 -->
    <template #default="{ item }">
      <span class="suggest">
        <span>{{ item.value.slice(0, item.typed) }}</span>
        <span class="suggest__rest">{{ item.value.slice(item.typed) }}</span>
      </span>
    </template>
  </el-autocomplete>
</template>

<style scoped>
.email-input {
  width: 100%;
}

.suggest {
  display: flex;
  align-items: center;
  /* 已输入部分用正文色，和补全部分的浅灰拉开对比 */
  color: var(--text-1);
}

.suggest__rest {
  color: var(--text-3);
}
</style>
