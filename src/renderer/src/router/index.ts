import { createRouter, createWebHashHistory } from 'vue-router'
import { ElMessage } from 'element-plus'
import MainLayout from '@renderer/layouts/MainLayout.vue'
import { useAuthStore } from '@renderer/stores'

/**
 * 冷启动先进启动页。
 *
 * ⚠️ 必须在 `createWebHashHistory()` **之前**改 hash：
 * history 对象在创建那一刻就把 `location.hash` 读进去了，之后监听的 hashchange
 * 是 install 时才挂上的。所以先改 hash 再创建 history，初始路由才是 `/start`；
 * 反过来（在 main.ts 里改）history 已经认定了 `/`，启动页永远不显示。
 *
 * hash 已有值时不覆盖 —— 开发时刷新停在当前页更省事，
 * 以后要做「记住上次页面」也改这里。
 */
if (!window.location.hash) {
  window.location.hash = '#/start'
}

/**
 * 用 hash 模式：生产环境是 loadFile() 加载本地 html，
 * history 模式在 file:// 下刷新/直接打开会 404。
 */
export const router = createRouter({
  history: createWebHashHistory(),
  routes: [
    // 启动页不在 MainLayout 里（整屏渐变，没有侧栏/顶栏）
    {
      path: '/start',
      name: 'start',
      component: () => import('@renderer/views/StartView.vue'),
      meta: { title: '启动' }
    },
    {
      path: '/',
      component: MainLayout,
      children: [
        {
          path: '',
          name: 'home',
          component: () => import('@renderer/views/HomeView.vue'),
          meta: { title: '主页' }
        },
        {
          path: 'balls/:color',
          name: 'ball',
          props: true,
          component: () => import('@renderer/views/BallView.vue'),
          meta: { title: '彩球' }
        },
        {
          // 详情页：列表卡片点进来，看完整打法（以后的评论区也在这页）
          path: 'balls/:color/:id',
          name: 'ball-detail',
          props: true,
          component: () => import('@renderer/views/BallDetailView.vue'),
          meta: { title: '彩球详情' }
        },
        {
          path: 'advanced/:category',
          name: 'advanced',
          props: true,
          component: () => import('@renderer/views/AdvancedView.vue'),
          meta: { title: '进阶' }
        },
        {
          // 详情页：列表卡片点进来，看完整内容（以后的评论区也在这页）
          path: 'advanced/:category/:id',
          name: 'advanced-detail',
          props: true,
          component: () => import('@renderer/views/AdvancedDetailView.vue'),
          meta: { title: '进阶详情' }
        },
        {
          // 我的投稿（T4.12）：待审 / 驳回的记录不在快照里，作者从这里看
          path: 'my-submissions',
          name: 'my-submissions',
          component: () => import('@renderer/views/MySubmissionsView.vue'),
          meta: { title: '我的投稿' }
        },
        {
          // 通知页（T4.9）：审核结果与系统通知的完整历史；超管在这里发系统通知
          path: 'notifications',
          name: 'notifications',
          component: () => import('@renderer/views/NotificationsView.vue'),
          meta: { title: '通知' }
        },
        {
          // 小键盘设置（T3.7）：步骤截图按系统版本分两套
          path: 'keyboard',
          name: 'keyboard',
          component: () => import('@renderer/views/KeyBoardView.vue'),
          meta: { title: '小键盘设置' }
        },
        {
          // 系统设置（T3.7）：主题 / 数据同步 / 版本与关于（旧版的「关于」页并入这里）
          path: 'settings',
          name: 'settings',
          component: () => import('@renderer/views/SettingsView.vue'),
          meta: { title: '系统设置' }
        },
        {
          // 账号页：从顶栏头像菜单进（侧栏不放，旧版也是从用户区进）
          path: 'account',
          name: 'account',
          component: () => import('@renderer/views/AccountView.vue'),
          meta: { title: '账号' }
        },
        {
          // 账户管理（D28）：菜单只对 admin / superadmin 显示，
          // meta.roles 才是"进不去"的那道门
          path: 'users',
          name: 'users',
          component: () => import('@renderer/views/UserManageView.vue'),
          meta: { title: '账户管理', roles: ['admin', 'superadmin'] }
        },
        {
          // 文案管理（D31）：只有超管能改站点文案
          path: 'content',
          name: 'content',
          component: () => import('@renderer/views/ContentView.vue'),
          meta: { title: '文案管理', roles: ['superadmin'] }
        },
        {
          path: ':pathMatch(.*)*',
          name: 'not-found',
          component: () => import('@renderer/views/NotFoundView.vue'),
          meta: { title: '页面不存在' }
        }
      ]
    }
  ]
})

/**
 * 路由级权限守卫（D28）
 *
 * 菜单按角色过滤只是"看不见"；直接改 hash 仍能打开页面，所以这里再挡一道。
 * 真正的最后一道防线永远是服务端 RPC 的校验。
 *
 * 身份还没确定时（`idle` / `loading`，冷启动刚进页面）**放行**：
 * 此时 `auth.role` 还是 `anon`，直接拦会把管理员误判成没权限。
 * 页面自己会按 `isAdmin` 显示「没有权限」，不会真露出数据。
 */
router.beforeEach((to) => {
  const roles = to.meta.roles as string[] | undefined
  if (!roles) return true

  const auth = useAuthStore()
  if (auth.status === 'idle' || auth.status === 'loading') return true
  if (roles.includes(auth.role)) return true

  ElMessage.warning('没有权限访问这个页面')
  return { name: 'home' }
})
