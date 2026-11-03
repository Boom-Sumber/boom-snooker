<script setup lang="ts">
/**
 * 账户管理页（T3.8，D28 / D29）
 *
 * 三条边界，页面只是"照抄"服务端的规则：
 *   1. 看得见谁：admin 只看自己邀请的，超管看全量（`list_users()` 决定，前端不再过滤）
 *   2. 能改谁：admin 只能改自己邀请的 viewer/advanced；超管可改除超管外的；谁都不能改自己
 *   3. 停用 = 软删除，可恢复；「连带隐藏内容」只隐藏不物理删，恢复时可一并还原
 *
 * 两栏（在用 / 已停用）是为了**误删可恢复**：停用后账户从「在用」消失，
 * 但仍在「已停用」里，随时能捞回来。
 */
import { computed, onMounted, ref, watch } from 'vue'
import { ElMessage, ElMessageBox } from 'element-plus'
import { ROLE_LABELS } from '@renderer/navigation/menu'
import { useAuthStore, useNetworkStore } from '@renderer/stores'
import {
  inviteCodeOf,
  listUsers,
  myInviteCode,
  resetInviteCodeOf,
  resetMyInviteCode,
  restoreUser,
  setUserRole,
  softDeleteUser,
  type AdminRole,
  type AdminUser
} from '@shared/api/admin'

const auth = useAuthStore()
/** 改角色 / 停用 / 恢复 / 重置邀请码都是写操作，离线全禁用（T6.1） */
const network = useNetworkStore()

const users = ref<AdminUser[]>([])
const loading = ref(false)
const loadError = ref('')

const tab = ref<'active' | 'deleted'>('active')
const page = ref(1)
const PAGE_SIZE = 20

const myCode = ref('')
const codeBusy = ref(false)

/** 停用对话框 */
const deleteVisible = ref(false)
const deleteTarget = ref<AdminUser | null>(null)
const deleteCascade = ref(false)
const deleteReason = ref('')
const deleteBusy = ref(false)

/** 恢复对话框 */
const restoreVisible = ref(false)
const restoreTarget = ref<AdminUser | null>(null)
const restoreContent = ref(false)
const restoreBusy = ref(false)

/** 超管查看某个管理员的邀请码 */
const otherCodeVisible = ref(false)
const otherCodeUser = ref<AdminUser | null>(null)
const otherCode = ref('')

const canEnter = computed(() => auth.isAdmin)

const activeUsers = computed(() => users.value.filter((user) => !user.deleted_at))
const deletedUsers = computed(() => users.value.filter((user) => user.deleted_at))
const currentRows = computed(() =>
  tab.value === 'active' ? activeUsers.value : deletedUsers.value
)
const pagedRows = computed(() =>
  currentRows.value.slice((page.value - 1) * PAGE_SIZE, page.value * PAGE_SIZE)
)

/** 范围说明：让管理员知道自己看到的是"我邀请的人"，不是全库 */
const scopeText = computed(() =>
  auth.isSuperadmin ? '全部账户（超级管理员视角）' : '你邀请的账户'
)

function formatTime(raw: string | null): string {
  if (!raw) return '—'
  const date = new Date(raw)
  if (Number.isNaN(date.getTime())) return raw
  const pad = (n: number): string => String(n).padStart(2, '0')
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())} ${pad(date.getHours())}:${pad(date.getMinutes())}`
}

function roleLabel(role: string): string {
  return ROLE_LABELS[role] ?? role
}

/**
 * 能不能对这个账户做用户管理
 *
 * 与服务端 `can_manage_user()` 一一对应，只是为了让按钮提前变灰。
 * 真正的拦截在 RPC 里（前端过滤不是安全边界）。
 */
function canManage(user: AdminUser): boolean {
  if (user.id === auth.user?.id) return false
  if (user.role === 'superadmin') return false
  if (auth.isSuperadmin) return true
  return auth.role === 'admin' && (user.role === 'viewer' || user.role === 'advanced')
}

/** 角色下拉的可选项：矩阵与 D26 一致（admin 只能 viewer↔advanced） */
function roleOptions(user: AdminUser): AdminRole[] {
  const options: AdminRole[] = ['viewer', 'advanced']
  if (auth.isSuperadmin) options.push('admin')
  // 当前角色也放进选项里，否则下拉会显示空值
  return options.includes(user.role as AdminRole) ? options : [...options, user.role as AdminRole]
}

async function load(): Promise<void> {
  if (!canEnter.value) return
  loading.value = true
  loadError.value = ''
  const result = await listUsers()
  loading.value = false
  if (!result.ok) {
    loadError.value = result.message
    return
  }
  users.value = result.data
}

async function loadMyCode(): Promise<void> {
  if (!canEnter.value) return
  codeBusy.value = true
  const result = await myInviteCode()
  codeBusy.value = false
  if (result.ok) myCode.value = result.data
  else ElMessage.error(result.message)
}

async function copyCode(code: string): Promise<void> {
  try {
    await navigator.clipboard.writeText(code)
    ElMessage.success('邀请码已复制')
  } catch {
    // 剪贴板权限被拒（少见）时退回老办法
    const input = document.createElement('textarea')
    input.value = code
    document.body.appendChild(input)
    input.select()
    document.execCommand('copy')
    document.body.removeChild(input)
    ElMessage.success('邀请码已复制')
  }
}

async function onResetMyCode(): Promise<void> {
  try {
    await ElMessageBox.confirm(
      '重置后旧邀请码立即失效，已经发出去的码都用不了了。确定重置？',
      '重置邀请码',
      { type: 'warning', confirmButtonText: '重置', cancelButtonText: '取消' }
    )
  } catch {
    return
  }
  const result = await resetMyInviteCode()
  if (!result.ok) {
    ElMessage.error(result.message)
    return
  }
  myCode.value = result.data
  ElMessage.success('已生成新的邀请码')
}

async function onRoleChange(user: AdminUser, role: AdminRole): Promise<void> {
  const previous = user.role
  if (previous === role) return
  const result = await setUserRole(user.id, role)
  if (!result.ok) {
    ElMessage.error(result.message)
    // 失败要把下拉恢复原值，否则界面会显示一个没生效的角色
    user.role = previous
    return
  }
  user.role = role
  ElMessage.success(`已把 ${user.nickname} 设为${roleLabel(role)}`)
  // 提升为管理员会断开邀请关系，列表要重新拉
  if (role === 'admin') await load()
}

function openDelete(user: AdminUser): void {
  deleteTarget.value = user
  deleteCascade.value = false
  deleteReason.value = ''
  deleteVisible.value = true
}

async function confirmDelete(): Promise<void> {
  const target = deleteTarget.value
  if (!target) return
  deleteBusy.value = true
  const result = await softDeleteUser(target.id, deleteCascade.value, deleteReason.value.trim())
  deleteBusy.value = false

  if (!result.ok) {
    ElMessage.error(result.message)
    return
  }

  const { hidden_records: records, hidden_comments: comments } = result.data
  ElMessage.success(
    deleteCascade.value
      ? `已停用，隐藏 ${records} 条记录 / ${comments} 条评论`
      : '已停用（内容保留，作者会显示「已停用」）'
  )
  deleteVisible.value = false
  tab.value = 'deleted'
  page.value = 1
  await load()
}

function openRestore(user: AdminUser): void {
  restoreTarget.value = user
  // 只有当初连带隐藏了内容才给勾选，否则这个选项没有意义
  restoreContent.value = user.hidden_count > 0
  restoreVisible.value = true
}

async function confirmRestore(): Promise<void> {
  const target = restoreTarget.value
  if (!target) return
  restoreBusy.value = true
  const result = await restoreUser(target.id, restoreContent.value && target.hidden_count > 0)
  restoreBusy.value = false

  if (!result.ok) {
    ElMessage.error(result.message)
    return
  }
  ElMessage.success(
    result.data.restored_records > 0
      ? `已恢复，同时恢复 ${result.data.restored_records} 条记录`
      : '已恢复'
  )
  restoreVisible.value = false
  tab.value = 'active'
  page.value = 1
  await load()
}

async function openOtherCode(user: AdminUser): Promise<void> {
  otherCodeUser.value = user
  otherCode.value = ''
  otherCodeVisible.value = true
  const result = await inviteCodeOf(user.id)
  if (!result.ok) {
    ElMessage.error(result.message)
    otherCodeVisible.value = false
    return
  }
  otherCode.value = result.data
}

async function onResetOtherCode(): Promise<void> {
  const user = otherCodeUser.value
  if (!user) return
  const result = await resetInviteCodeOf(user.id)
  if (!result.ok) {
    ElMessage.error(result.message)
    return
  }
  otherCode.value = result.data
  ElMessage.success('已生成新的邀请码')
}

// 换栏要回到第一页，否则会停在一个空的页码上
watch(tab, () => {
  page.value = 1
})

/**
 * 冷启动时这个页面可能比 auth 先挂载（`auth.status` 还是 `idle`），
 * 那一轮 `canEnter` 是 false、`load()` 直接返回 —— 等身份确定后必须再拉一次，
 * 否则邀请码永远显示「—」、列表永远是空的。
 */
watch(
  () => auth.status,
  (status) => {
    if (status === 'signedIn') void refreshAll()
  }
)

async function refreshAll(): Promise<void> {
  await Promise.all([load(), loadMyCode()])
}

onMounted(() => {
  void refreshAll()
})
</script>

<template>
  <section class="manage">
    <header class="manage__head">
      <div>
        <h1 class="manage__title">账户管理</h1>
        <p class="manage__sub">
          当前范围：{{ scopeText }} · 共 {{ activeUsers.length }} 个在用<span
            v-if="deletedUsers.length"
          >
            、{{ deletedUsers.length }} 个已停用</span
          >
        </p>
      </div>
      <el-button :loading="loading" @click="load">刷新</el-button>
    </header>

    <!-- 没有权限（比如普通用户直接改 hash 进来）：只显示说明，不请求数据 -->
    <div v-if="!canEnter" class="card empty">
      <p class="empty__title">没有权限</p>
      <p class="empty__text">账户管理只对管理员和超级管理员开放。</p>
    </div>

    <template v-else>
      <!-- 邀请码卡片 -->
      <div class="card code">
        <div class="code__text">
          <p class="code__label">我的邀请码</p>
          <p class="code__value">{{ myCode || (codeBusy ? '生成中…' : '—') }}</p>
          <p class="code__hint">把码发给要邀请的人，注册时必填。重置后旧码立即失效。</p>
        </div>
        <div class="code__actions">
          <el-button :disabled="!myCode" @click="copyCode(myCode)">复制</el-button>
          <el-button :loading="codeBusy" :disabled="network.offline" @click="onResetMyCode">
            重置
          </el-button>
        </div>
      </div>

      <!-- 两栏：在用 / 已停用 -->
      <div class="card list">
        <el-radio-group v-model="tab" class="list__tabs">
          <el-radio-button value="active">在用（{{ activeUsers.length }}）</el-radio-button>
          <el-radio-button value="deleted">已停用（{{ deletedUsers.length }}）</el-radio-button>
        </el-radio-group>

        <p v-if="loadError" class="list__error">{{ loadError }}</p>

        <el-table
          v-loading="loading"
          :data="pagedRows"
          class="list__table"
          empty-text="这里还没有账户"
        >
          <!-- 昵称 + 邮箱合成一列：邮箱很长，单独占一列会把表格撑到横向滚动 -->
          <el-table-column label="账户" min-width="220">
            <template #default="{ row }">
              <div class="cell__name-row">
                <span class="cell__name">{{ row.nickname }}</span>
                <span v-if="row.id === auth.user?.id" class="cell__self">我</span>
              </div>
              <div class="cell__email">{{ row.email || '—' }}</div>
            </template>
          </el-table-column>

          <!-- 角色列给最小宽度：下拉框比纯文本宽，128px 会把右边框挤掉 -->
          <el-table-column label="角色" min-width="150">
            <template #default="{ row }">
              <el-select
                v-if="canManage(row) && !row.deleted_at"
                :model-value="row.role"
                size="small"
                class="cell__role"
                :disabled="network.offline"
                @change="(value: AdminRole) => onRoleChange(row, value)"
              >
                <el-option
                  v-for="role in roleOptions(row)"
                  :key="role"
                  :value="role"
                  :label="roleLabel(role)"
                />
              </el-select>
              <span v-else class="role" :class="{ 'role--muted': row.role === 'superadmin' }">
                {{ roleLabel(row.role) }}
              </span>
            </template>
          </el-table-column>

          <el-table-column label="邀请人" min-width="120">
            <template #default="{ row }">
              {{ row.inviter_nickname || (row.role === 'superadmin' ? '—' : '历史账号') }}
            </template>
          </el-table-column>

          <template v-if="tab === 'active'">
            <el-table-column label="注册时间" min-width="170">
              <template #default="{ row }">
                <span class="cell__time">{{ formatTime(row.created_at) }}</span>
              </template>
            </el-table-column>
          </template>

          <template v-else>
            <el-table-column label="停用人" min-width="7rem">
              <template #default="{ row }">{{ row.deleter_nickname || '—' }}</template>
            </el-table-column>
            <el-table-column label="停用时间" min-width="170">
              <template #default="{ row }">
                <span class="cell__time">{{ formatTime(row.deleted_at) }}</span>
              </template>
            </el-table-column>
            <el-table-column label="原因" min-width="140" show-overflow-tooltip>
              <template #default="{ row }">{{ row.deleted_reason || '—' }}</template>
            </el-table-column>
            <el-table-column label="隐藏内容" min-width="100">
              <template #default="{ row }">{{ row.hidden_count }} 条</template>
            </el-table-column>
          </template>

          <!-- 固定在最右侧：列多时表格会横向滚动，操作列不能被滚走 -->
          <el-table-column label="操作" :width="130" align="right" fixed="right">
            <template #default="{ row }">
              <el-button
                v-if="canManage(row) && !row.deleted_at"
                link
                type="danger"
                :disabled="network.offline"
                @click="openDelete(row)"
              >
                停用
              </el-button>
              <el-button
                v-else-if="canManage(row) && row.deleted_at"
                link
                type="primary"
                :disabled="network.offline"
                @click="openRestore(row)"
              >
                恢复
              </el-button>
              <span v-else class="cell__na">—</span>

              <el-button
                v-if="
                  auth.isSuperadmin &&
                  (row.role === 'admin' || row.role === 'superadmin') &&
                  !row.deleted_at
                "
                link
                @click="openOtherCode(row)"
              >
                邀请码
              </el-button>
            </template>
          </el-table-column>
        </el-table>

        <el-pagination
          v-if="currentRows.length > PAGE_SIZE"
          v-model:current-page="page"
          class="list__pager"
          layout="prev, pager, next"
          :page-size="PAGE_SIZE"
          :total="currentRows.length"
        />
      </div>
    </template>

    <!-- 停用确认框 -->
    <el-dialog v-model="deleteVisible" title="停用账户" width="min(30rem, 94vw)" destroy-on-close>
      <p class="dialog__who">
        账户：<strong>{{ deleteTarget?.nickname }}</strong
        >（{{ roleLabel(deleteTarget?.role ?? '') }}）
      </p>

      <ul class="dialog__notes">
        <li>停用后<strong>无法登录</strong>（账号不会被删除，历史记录的作者仍保留）</li>
        <li>被停用的账号会出现在「已停用」栏，随时可以恢复</li>
        <li>
          不勾选连带隐藏时，他发的内容与评论<strong>照常显示</strong>，作者名旁会出现「已停用」
        </li>
      </ul>

      <el-checkbox v-model="deleteCascade" class="dialog__check">
        连带隐藏他的全部内容与评论
      </el-checkbox>
      <p class="dialog__hint">
        只隐藏、不物理删除；恢复账户时可以一并还原。若还有待审内容，不勾选会被拦下。
      </p>

      <el-input
        v-model="deleteReason"
        class="dialog__reason"
        maxlength="50"
        show-word-limit
        placeholder="停用原因（可选，会记进审计）"
      />

      <template #footer>
        <el-button :disabled="deleteBusy" @click="deleteVisible = false">取消</el-button>
        <el-button
          type="danger"
          :loading="deleteBusy"
          :disabled="network.offline"
          @click="confirmDelete"
        >
          确认停用
        </el-button>
      </template>
    </el-dialog>

    <!-- 恢复确认框 -->
    <el-dialog v-model="restoreVisible" title="恢复账户" width="min(28rem, 94vw)" destroy-on-close>
      <p class="dialog__who">
        账户：<strong>{{ restoreTarget?.nickname }}</strong>
      </p>
      <p class="dialog__hint">恢复后该账户可以正常登录，权限与停用前一致。</p>

      <el-checkbox
        v-if="(restoreTarget?.hidden_count ?? 0) > 0"
        v-model="restoreContent"
        class="dialog__check"
      >
        一并恢复当初被隐藏的 {{ restoreTarget?.hidden_count }} 条内容
      </el-checkbox>
      <p v-else class="dialog__hint">这个账户停用时没有隐藏任何内容，无需选择。</p>

      <template #footer>
        <el-button :disabled="restoreBusy" @click="restoreVisible = false">取消</el-button>
        <el-button
          type="primary"
          :loading="restoreBusy"
          :disabled="network.offline"
          @click="confirmRestore"
        >
          确认恢复
        </el-button>
      </template>
    </el-dialog>

    <!-- 超管查看 / 重置某个管理员的邀请码 -->
    <el-dialog v-model="otherCodeVisible" title="邀请码" width="min(26rem, 94vw)" destroy-on-close>
      <p class="dialog__who">
        {{ otherCodeUser?.nickname }} · {{ roleLabel(otherCodeUser?.role ?? '') }}
      </p>
      <p class="code__value code__value--dialog">{{ otherCode || '加载中…' }}</p>
      <template #footer>
        <el-button :disabled="!otherCode" @click="copyCode(otherCode)">复制</el-button>
        <el-button type="warning" :disabled="network.offline" @click="onResetOtherCode">
          重置
        </el-button>
        <el-button @click="otherCodeVisible = false">关闭</el-button>
      </template>
    </el-dialog>
  </section>
</template>

<style scoped>
.manage {
  display: flex;
  flex-direction: column;
  gap: 0.875rem;
  padding: clamp(16px, 2.2vw, 28px);
}

.manage__head {
  display: flex;
  gap: 1rem;
  align-items: flex-start;
  justify-content: space-between;
}

.manage__title {
  margin: 0;
  font-size: clamp(1.25rem, 1.6vw, 1.5rem);
  font-weight: 500;
  color: var(--text-1);
}

.manage__sub {
  margin: 0.25rem 0 0;
  font-size: var(--font-size-sm);
  color: var(--text-2);
}

.code {
  display: flex;
  gap: 1rem;
  align-items: center;
  justify-content: space-between;
  padding: 1rem 1.25rem;
}

.code__label {
  margin: 0;
  font-size: var(--font-size-sm);
  color: var(--text-3);
}

.code__value {
  margin: 0.25rem 0 0;
  font-family: ui-monospace, 'Cascadia Mono', Consolas, monospace;
  font-size: clamp(1.125rem, 1.5vw, 1.375rem);
  letter-spacing: 0.14em;
  color: var(--primary);
}

.code__value--dialog {
  padding: 0.5rem 0;
  text-align: center;
}

.code__hint {
  margin: 0.375rem 0 0;
  font-size: var(--font-size-sm);
  color: var(--text-2);
}

.code__actions {
  display: flex;
  flex: none;
  gap: 0.5rem;
}

.list {
  /* 表格要贴到卡片两侧边框：卡片本身不留左右内边距，由里面的元素自己留 */
  padding: 0;
  overflow: hidden;
}

.list__tabs {
  padding: 0.875rem 1rem 0;
  margin-bottom: 0.75rem;
}

.list__table {
  width: 100%;
  /* 表格不要自己的底色，露出卡片背景 */
  --el-table-bg-color: transparent;
  --el-table-tr-bg-color: transparent;
  --el-table-header-bg-color: transparent;
  --el-table-row-hover-bg-color: var(--surface-2);
  --el-table-border-color: var(--border);
  background: transparent;
}

/* 去掉表格自带的底部横线：它只横到内容区，和卡片边框对不齐 */
.list__table :deep(.el-table__inner-wrapper::before) {
  display: none;
}

/* 单元格左右留白统一，行分割线两端到卡片边框距离才一致。
   el-table 默认在 td 和内部 .cell 上各有一层 padding，两层叠加会把内容挤窄，
   这里把内层清掉，只保留 td 的这层 */
.list__table :deep(.el-table .cell) {
  padding-left: 0;
  padding-right: 0;
}

.list__table :deep(.el-table__cell) {
  padding-left: 1rem;
  padding-right: 1rem;
}

.list__table :deep(.el-table__cell:first-child) {
  padding-left: 1.25rem;
}

.list__table :deep(.el-table__cell:last-child) {
  padding-right: 1.25rem;
}

.list__error {
  margin: 0 1rem 0.75rem;
  padding: 0.5rem 0.75rem;
  font-size: var(--font-size-sm);
  color: var(--danger);
  background: color-mix(in srgb, var(--danger) 10%, transparent);
  border-radius: var(--radius-sm);
}

.list__pager {
  justify-content: flex-end;
  margin-top: 0.75rem;
  padding: 0 1rem 1rem;
}

.cell__name-row {
  display: flex;
  gap: 0.375rem;
  align-items: center;
  min-width: 0;
}

.cell__name {
  overflow: hidden;
  color: var(--text-1);
  text-overflow: ellipsis;
  white-space: nowrap;
}

/* 邮箱做副行：字号小一档、颜色更浅，不抢昵称的注意力 */
.cell__email {
  overflow: hidden;
  font-size: var(--font-size-sm);
  color: var(--text-3);
  text-overflow: ellipsis;
  white-space: nowrap;
}

.cell__self {
  margin-left: 0.375rem;
  padding: 0 0.375rem;
  font-size: var(--font-size-sm);
  color: var(--text-2);
  background: var(--surface-2);
  border-radius: 999px;
}

.cell__role {
  /* 跟着单元格宽度走：固定 7.5rem 会超出列宽，右边框被裁掉 */
  width: 100%;
}

.cell__na {
  color: var(--text-3);
}

/* 时间列固定宽度后仍然不换行，避免「2026-11-01 / 23:22」折成两行 */
.cell__time {
  white-space: nowrap;
}

.role {
  display: inline-block;
  padding: 0.0625rem 0.5rem;
  font-size: var(--font-size-sm);
  color: #fff;
  background: var(--primary);
  border-radius: 999px;
}

.role--muted {
  color: var(--text-2);
  background: var(--surface-2);
}

.dialog__who {
  margin: 0 0 0.75rem;
  color: var(--text-1);
}

.dialog__notes {
  margin: 0 0 0.75rem;
  padding-left: 1.125rem;
  font-size: var(--font-size-sm);
  line-height: 1.9;
  color: var(--text-2);
}

.dialog__check {
  display: block;
  margin-bottom: 0.375rem;
}

.dialog__hint {
  margin: 0 0 0.75rem;
  font-size: var(--font-size-sm);
  line-height: 1.7;
  color: var(--text-3);
}

.dialog__reason {
  margin-top: 0.25rem;
}

.empty {
  padding: 2rem;
  text-align: center;
}

.empty__title {
  margin: 0;
  font-size: var(--font-size-lg);
  color: var(--text-1);
}

.empty__text {
  margin: 0.5rem 0 0;
  font-size: var(--font-size-sm);
  color: var(--text-2);
}
</style>
