import 'element-plus/dist/index.css'
import 'element-plus/theme-chalk/dark/css-vars.css'
import './styles/theme.css'
import './styles/iconfont.css'
import './assets/main.css'

import { createApp } from 'vue'
import ElementPlus from 'element-plus'
import zhCn from 'element-plus/es/locale/lang/zh-cn'
import { initAuth } from '@shared/auth'
import App from './App.vue'
import { router } from './router'
import { initTheme } from './theme'

// 首帧之前把主题定下来（不闪）
initTheme()

createApp(App).use(ElementPlus, { locale: zhCn }).use(router).mount('#app')

// 读回加密保存的会话，并让 token 自动刷新开始计时。
// 不阻塞挂载：D22 之后未登录也能看数据，认证失败不该拦住首屏。
void initAuth()
  .then((session) => {
    if (session) console.info('[auth] 已恢复登录会话')
  })
  .catch((error: unknown) => console.error('[auth] 恢复会话失败：', error))
