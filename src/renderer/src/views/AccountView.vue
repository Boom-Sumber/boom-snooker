<script setup lang="ts">
/**
 * 账号页
 *
 * 对照旧版 `AccountView.xaml`：用户信息（头像 / 昵称 / 角色）+ 登录/登出 + 修改密码。
 * 新版多了「邮箱」和「注册时间」两行 —— Supabase 用邮箱登录，用户名这个概念没有了。
 *
 * 未登录也能进这一页：显示登录入口 + 一句说明（D22：浏览不需要登录）。
 */
import { computed, ref } from 'vue'
import { ElMessage } from 'element-plus'
import LoginDialog from '@renderer/components/LoginDialog.vue'
import ChangePasswordDialog from '@renderer/components/ChangePasswordDialog.vue'
import ProfileEditDialog from '@renderer/components/ProfileEditDialog.vue'
import { GENDER_LABELS, resolveAvatar } from '@renderer/assets/avatars'
import { ROLE_LABELS } from '@renderer/navigation/menu'
import { useAuthStore } from '@renderer/stores'

const auth = useAuthStore()

const loginVisible = ref(false)
const passwordVisible = ref(false)
const profileVisible = ref(false)

const avatarSrc = computed(() => resolveAvatar(auth.avatar, auth.gender))
const roleLabel = computed(() => ROLE_LABELS[auth.role] ?? auth.role)
const genderLabel = computed(() => GENDER_LABELS[auth.gender])
const email = computed(() => auth.user?.email ?? '')

const createdAt = computed(() => {
  const raw = auth.profile?.created_at
  if (!raw) return ''
  const date = new Date(raw)
  if (Number.isNaN(date.getTime())) return raw
  const pad = (n: number): string => String(n).padStart(2, '0')
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`
})

/** 当前角色能做什么（一句话，方便用户理解为什么按钮是灰的） */
const permissionText = computed(() => {
  switch (auth.role) {
    case 'superadmin':
      return '可以管理全部用户与角色，不参与内容审核'
    case 'admin':
      return '可以新增 / 编辑 / 删除自己的记录（免审核），并审核其他人的投稿与评论'
    case 'advanced':
      return '可以投稿，新增或修改后需要管理员审核通过才会展示'
    case 'viewer':
      return '可以浏览全部内容；评论功能在阶段 4 开放'
    default:
      return '未登录也可以浏览全部内容，登录后才能评论和投稿'
  }
})

async function onSignOut(): Promise<void> {
  await auth.signOut()
  ElMessage.success('已登出')
}
</script>

<template>
  <section class="account">
    <header class="account__head">
      <h1 class="account__title">用户信息</h1>
      <p class="account__sub">账号由管理员开通，忘记密码可以找管理员重置</p>
    </header>

    <div class="account__body card">
      <div class="profile">
        <el-avatar :size="72" :src="avatarSrc" class="profile__avatar" />

        <dl class="profile__info">
          <div class="row">
            <dt>昵称</dt>
            <dd>{{ auth.nickname || '未登录' }}</dd>
          </div>
          <div class="row">
            <dt>邮箱</dt>
            <dd>{{ email || '—' }}</dd>
          </div>
          <div class="row">
            <dt>角色</dt>
            <dd>
              <span class="role" :class="{ 'role--anon': !auth.isSignedIn }">{{ roleLabel }}</span>
            </dd>
          </div>
          <div class="row">
            <dt>性别</dt>
            <dd>{{ auth.isSignedIn ? genderLabel : '—' }}</dd>
          </div>
          <div class="row">
            <dt>注册时间</dt>
            <dd>{{ createdAt || '—' }}</dd>
          </div>
        </dl>
      </div>

      <p class="permission">{{ permissionText }}</p>

      <div class="actions">
        <template v-if="auth.isSignedIn">
          <el-button @click="profileVisible = true">编辑资料</el-button>
          <el-button @click="passwordVisible = true">修改密码</el-button>
          <el-button type="danger" plain @click="onSignOut">登出</el-button>
        </template>
        <el-button v-else type="primary" @click="loginVisible = true">登录</el-button>
      </div>
    </div>

    <LoginDialog v-model:visible="loginVisible" />
    <ChangePasswordDialog v-model:visible="passwordVisible" />
    <ProfileEditDialog v-model:visible="profileVisible" />
  </section>
</template>

<style scoped>
.account {
  display: flex;
  flex-direction: column;
  gap: 0.875rem;
  padding: clamp(16px, 2.2vw, 28px);
}

.account__title {
  margin: 0;
  font-size: clamp(1.25rem, 1.6vw, 1.5rem);
  font-weight: 500;
  color: var(--text-1);
}

.account__sub {
  margin: 0.25rem 0 0;
  font-size: var(--font-size-sm);
  color: var(--text-2);
}

.account__body {
  display: flex;
  flex-direction: column;
  gap: 1.25rem;
  width: 100%;
  max-width: 40rem;
  padding: clamp(1rem, 1.6vw, 1.75rem);
}

.profile {
  display: flex;
  gap: 1.5rem;
  align-items: flex-start;
}

.profile__avatar {
  flex: none;
  background: color-mix(in srgb, var(--primary) 12%, var(--surface));
}

.profile__info {
  display: flex;
  flex: 1;
  flex-direction: column;
  gap: 0.625rem;
  min-width: 0;
  margin: 0;
}

.row {
  display: grid;
  grid-template-columns: 5rem 1fr;
  gap: 0.5rem;
  font-size: 0.9375rem;
  line-height: 1.6;
}

.row dt {
  color: var(--text-3);
}

.row dd {
  margin: 0;
  color: var(--text-1);
  overflow-wrap: anywhere;
}

/* 角色用胶囊标出来，和详情页的"球 / 袋"保持同一套视觉语言 */
.role {
  display: inline-block;
  padding: 0.0625rem 0.5rem;
  font-size: var(--font-size-sm);
  color: #fff;
  background: var(--primary);
  border-radius: 999px;
}

.role--anon {
  color: var(--text-2);
  background: var(--surface-2);
}

.permission {
  margin: 0;
  padding: 0.625rem 0.75rem;
  font-size: var(--font-size-sm);
  line-height: 1.7;
  color: var(--text-2);
  background: var(--surface-2);
  border-radius: var(--radius-sm);
}

.actions {
  display: flex;
  gap: 0.75rem;
  justify-content: flex-end;
}

@media (max-width: 40rem) {
  .profile {
    flex-direction: column;
    align-items: center;
    text-align: left;
  }
}
</style>
