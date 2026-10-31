/**
 * 环境变量类型（主进程 / 渲染进程共用）
 *
 * 值来自项目根目录的 `.env.local`（不入库，见 .gitignore）。
 * electron-vite 对 `VITE_` 前缀的变量在主/预加载/渲染三个进程都做注入，
 * 所以这里声明一次，三处都能用 `import.meta.env.VITE_xxx`。
 *
 * 注意：变量在**构建时**被静态替换，改了 `.env.local` 必须重启 dev server，
 * 热更新不会生效。
 */
interface ImportMetaEnv {
  /** Supabase 项目 URL，形如 https://xxxx.supabase.co */
  readonly VITE_SUPABASE_URL?: string
  /** Supabase publishable / anon key（设计上可公开，安全边界在 RLS） */
  readonly VITE_SUPABASE_KEY?: string
  /**
   * 开发期自动登录用的测试账号（**只在 `npm run dev` 下生效**）
   *
   * 登录界面要等 T3.5，在那之前靠这两个变量让开发时自动带上会话。
   * 生产构建里 `import.meta.env.DEV` 为 false，这段逻辑不会执行。
   */
  readonly VITE_DEV_LOGIN_EMAIL?: string
  readonly VITE_DEV_LOGIN_PASSWORD?: string
}
