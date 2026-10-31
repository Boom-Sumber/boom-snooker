/**
 * 开发期自动登录（**只在 `npm run dev` 下生效**）
 *
 * 为什么需要：登录界面要等 T3.5。在那之前，新增/编辑/删除这些写操作
 * 都要登录才能测，每次手动敲 `auth.signIn()` 太麻烦。
 *
 * 账号来源：`.env.local` 的 `VITE_DEV_LOGIN_EMAIL` / `VITE_DEV_LOGIN_PASSWORD`
 * （文件不入库）。不配这两个变量就完全不生效。
 *
 * 安全边界：
 *   - `import.meta.env.DEV` 在 `npm run build` 时是 `false`，整段逻辑不会执行；
 *   - 就算有人把生产包打开，凭据也来自构建时的 env，而生产构建不读这两个变量。
 *
 * 想测「未登录」或「普通用户」状态：注释掉 `.env.local` 里那两行再重启 dev，
 * 或者在界面上用头像菜单登出（登出后不会被自动登录顶回去，因为只在启动时跑一次）。
 */
import { useAuthStore } from '@renderer/stores'

export async function autoLoginIfConfigured(): Promise<void> {
  if (!import.meta.env.DEV) return

  const email = import.meta.env.VITE_DEV_LOGIN_EMAIL
  const password = import.meta.env.VITE_DEV_LOGIN_PASSWORD
  if (!email || !password) return

  const auth = useAuthStore()
  if (auth.isSignedIn) return

  const result = await auth.signIn(email, password)
  if (result.ok) {
    console.info(`[dev] 已自动登录：${email}（角色 ${auth.role}）`)
  } else {
    console.warn(`[dev] 自动登录失败：${result.message}`)
  }
}
