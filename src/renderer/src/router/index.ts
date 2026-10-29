import { createRouter, createWebHashHistory } from 'vue-router'
import MainLayout from '@renderer/layouts/MainLayout.vue'

/**
 * 用 hash 模式：生产环境是 loadFile() 加载本地 html，
 * history 模式在 file:// 下刷新/直接打开会 404。
 */
export const router = createRouter({
  history: createWebHashHistory(),
  routes: [
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
          path: 'advanced/:category',
          name: 'advanced',
          props: true,
          component: () => import('@renderer/views/AdvancedView.vue'),
          meta: { title: '进阶' }
        },
        {
          path: 'about',
          name: 'about',
          component: () => import('@renderer/views/AboutView.vue'),
          meta: { title: '关于' }
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
