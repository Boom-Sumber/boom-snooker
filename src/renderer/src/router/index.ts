import { createRouter, createWebHashHistory } from 'vue-router'
import MainLayout from '@renderer/layouts/MainLayout.vue'

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
          path: 'about',
          name: 'about',
          component: () => import('@renderer/views/AboutView.vue'),
          meta: { title: '关于' }
        },
        {
          // 账号页：从顶栏头像菜单进（侧栏不放，旧版也是从用户区进）
          path: 'account',
          name: 'account',
          component: () => import('@renderer/views/AccountView.vue'),
          meta: { title: '账号' }
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
