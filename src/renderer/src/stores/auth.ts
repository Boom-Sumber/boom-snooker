/**
 * 认证 store
 *
 * 只做三件事：缓存当前会话与 profile、把角色换算成能力布尔值、把登录/登出
 * 包成 action。真正的网络与加密存储在 `@shared/auth`。
 *
 * 为什么角色要在这里算成 `canWrite` / `isAdmin` 而不是到处写
 * `role === 'admin' || role === 'superadmin'`：权限矩阵在 docs/03 第 9 节，
 * 以后调整只改这一处；散落在组件里的字符串比较必然漏改。
 */
import { defineStore } from 'pinia'
import { computed, ref } from 'vue'
import { ElMessage } from 'element-plus'
import type { Session } from '@supabase/supabase-js'
import {
  changePassword as apiChangePassword,
  getMyProfile,
  getSession,
  onAuthStateChange,
  signIn as apiSignIn,
  signOut as apiSignOut,
  signUp as apiSignUp,
  updateMyProfile,
  type Gender,
  type PasswordResult,
  type Profile,
  type ProfilePatch,
  type ProfileResult,
  type RoleCode,
  type SignInResult
} from '@shared/auth'

export type AuthStatus = 'idle' | 'loading' | 'signedIn' | 'signedOut'

export const useAuthStore = defineStore('auth', () => {
  const session = ref<Session | null>(null)
  const profile = ref<Profile | null>(null)
  const status = ref<AuthStatus>('idle')
  const errorMessage = ref('')

  const user = computed(() => session.value?.user ?? null)
  const isSignedIn = computed(() => session.value !== null)

  /** 未登录 / 没有 profile 行一律按 `anon` 处理（与数据库 `current_role_code()` 对齐） */
  const role = computed<RoleCode | 'anon'>(() => (profile.value?.role as RoleCode) ?? 'anon')

  const nickname = computed(() => profile.value?.nickname ?? '')
  const avatar = computed(() => profile.value?.avatar ?? '')
  /** 性别：老数据可能为 null，统一按 male 处理（与数据库默认值一致） */
  const gender = computed<Gender>(() => (profile.value?.gender === 'female' ? 'female' : 'male'))

  /** 能写记录（投稿）：高级 / 管理员 / 超管 */
  const canWrite = computed(() =>
    (['advanced', 'admin', 'superadmin'] as string[]).includes(role.value)
  )
  /** 能审核：管理员 / 超管（超管只做用户权限，见 docs/03 第 9 节，审核入口按 admin 判断） */
  const isAdmin = computed(() => (['admin', 'superadmin'] as string[]).includes(role.value))
  const isSuperadmin = computed(() => role.value === 'superadmin')

  let unsubscribe: (() => void) | null = null

  /**
   * `loadProfile` 的并发锁
   *
   * `signIn` 和 `onAuthStateChange` 会**同时**调它，被停用账号会两次命中"踢下线"分支，
   * 弹两遍提示、发两次登出。光在分支里加标记不行（两次都先 await 再判断，照样都进来），
   * 必须在函数入口就挡住。
   */
  let loadingProfile = false

  async function loadProfile(): Promise<void> {
    if (loadingProfile) return
    loadingProfile = true
    try {
      const next = await getMyProfile()

      /*
       * 被停用的账号仍然能通过 Supabase Auth 登录（D25：不删 auth.users），
       * 所以"停用"必须在拿到 profile 这一刻生效 —— 立即登出并提示。
       * 数据库那边权限层已经把这种账号当 anon 处理（deleted_at is null 才算角色），
       * 这里是**体验层**的兜底，不是安全边界。
       */
      if (next?.deleted_at) {
        profile.value = null
        ElMessage.warning('账号已停用，请联系管理员')
        await signOut()
        return
      }

      profile.value = next
    } catch (error) {
      console.error('[auth] 读取 profile 失败：', error)
      profile.value = null
    } finally {
      loadingProfile = false
    }
  }

  /**
   * 启动时调一次：恢复加密保存的会话 + 订阅后续变化
   *
   * 重复调用是安全的（`status !== 'idle'` 直接返回），HMR 或路由切换误调不会重复订阅。
   */
  async function init(): Promise<void> {
    if (status.value !== 'idle') return
    status.value = 'loading'

    try {
      session.value = await getSession()
    } catch (error) {
      console.error('[auth] 恢复会话失败：', error)
      session.value = null
    }

    if (session.value) {
      await loadProfile()
      status.value = 'signedIn'
    } else {
      status.value = 'signedOut'
    }

    unsubscribe = onAuthStateChange((event, next) => {
      session.value = next
      if (event === 'SIGNED_OUT' || !next) {
        profile.value = null
        status.value = 'signedOut'
        return
      }
      status.value = 'signedIn'
      // SIGNED_IN / TOKEN_REFRESHED / USER_UPDATED 都刷一次 profile：
      // 管理员改了昵称或角色，客户端要能跟上
      void loadProfile()
    })
  }

  async function signIn(email: string, password: string): Promise<SignInResult> {
    errorMessage.value = ''
    const result = await apiSignIn(email, password)
    if (!result.ok) {
      errorMessage.value = result.message
      return result
    }
    session.value = result.session
    await loadProfile()
    status.value = 'signedIn'
    return result
  }

  /**
   * 注册（D27 邀请制，邮箱确认已关闭 → 注册即登录）
   *
   * 邀请码 / 昵称 / 性别随 `signUp` 的 metadata 一起提交，
   * 由 `handle_new_user` 校验邀请码并写进 profiles（migration 020）。
   */
  async function signUp(
    email: string,
    password: string,
    nickname: string,
    genderCode: Gender,
    inviteCode: string
  ): Promise<SignInResult> {
    errorMessage.value = ''
    const result = await apiSignUp(email, password, {
      nickname,
      gender: genderCode,
      inviteCode
    })
    if (!result.ok) {
      errorMessage.value = result.message
      return result
    }
    session.value = result.session
    await loadProfile()
    status.value = 'signedIn'
    return result
  }

  /** 改自己的昵称 / 头像 / 性别（角色不在这里） */
  async function updateProfile(patch: ProfilePatch): Promise<ProfileResult> {
    const result = await updateMyProfile(patch)
    if (result.ok) profile.value = result.profile
    return result
  }

  async function signOut(): Promise<void> {
    await apiSignOut()
    session.value = null
    profile.value = null
    status.value = 'signedOut'
  }

  /**
   * 改密：成功即强制登出（旧版逻辑，`docs/04` §5.7）
   *
   * 登出放在这里而不是组件里，是为了保证"改成功就一定登出" ——
   * 密码变了，旧 token 虽然还有效，但让用户用新密码重新登录一次更稳妥。
   */
  async function changePassword(oldPassword: string, newPassword: string): Promise<PasswordResult> {
    const result = await apiChangePassword(oldPassword, newPassword)
    if (result.ok) await signOut()
    return result
  }

  /** 组件卸载 / HMR 时取消订阅 */
  function dispose(): void {
    unsubscribe?.()
    unsubscribe = null
  }

  return {
    session,
    profile,
    status,
    errorMessage,
    user,
    isSignedIn,
    role,
    nickname,
    avatar,
    gender,
    canWrite,
    isAdmin,
    isSuperadmin,
    init,
    loadProfile,
    signIn,
    signUp,
    updateProfile,
    signOut,
    changePassword,
    dispose
  }
})
