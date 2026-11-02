<script setup lang="ts">
/**
 * 审核回显（T4.13）
 *
 * 统一格式：`由 管理员 张三 审核 · 2026-11-02 21:21 [已通过]`
 *
 * 只用在"作者看自己的东西"的场景 —— 数据由服务端按 `auth.uid()` 过滤，
 * 别人的内容拿不到 reviewer_* 字段（返回 null），组件也就不渲染。
 */
import { computed } from 'vue'

const props = defineProps<{
  /** 审核人昵称 */
  name?: string | null
  /** 审核人角色：admin / superadmin / advanced ... */
  role?: string | null
  /** 审核时间 */
  at?: string | null
  /** 审核结论 */
  status: 'visible' | 'rejected'
}>()

const ROLE_LABELS: Record<string, string> = {
  superadmin: '超级管理员',
  admin: '管理员',
  advanced: '高级用户',
  viewer: '普通用户'
}

const roleLabel = computed(() => ROLE_LABELS[props.role ?? ''] ?? '管理员')

function formatTime(raw: string | null | undefined): string {
  if (!raw) return ''
  const date = new Date(raw)
  if (Number.isNaN(date.getTime())) return raw
  const pad = (n: number): string => String(n).padStart(2, '0')
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())} ${pad(date.getHours())}:${pad(date.getMinutes())}`
}

const timeText = computed(() => formatTime(props.at))

/** 「管理员 张三」/「管理员」（没有昵称时不留空档） */
const whoText = computed(() => (props.name ? `${roleLabel.value} ${props.name}` : roleLabel.value))
</script>

<template>
  <p class="stamp">
    <span class="stamp__text">
      由 {{ whoText }} 审核<template v-if="timeText"> · {{ timeText }}</template>
    </span>
    <el-tag size="small" :type="status === 'visible' ? 'success' : 'info'" effect="plain">
      {{ status === 'visible' ? '已通过' : '未通过' }}
    </el-tag>
  </p>
</template>

<style scoped>
.stamp {
  display: flex;
  flex-wrap: wrap;
  gap: 0.375rem;
  align-items: center;
  margin: 0;
  font-size: var(--font-size-sm);
  color: var(--text-3);
}

.stamp__text {
  white-space: nowrap;
}
</style>
