import 'element-plus/dist/index.css'
import 'element-plus/theme-chalk/dark/css-vars.css'
import './styles/theme.css'
import './styles/iconfont.css'
import './styles/overlay.css'
import './assets/main.css'

import { createApp } from 'vue'
import { createPinia } from 'pinia'
import ElementPlus from 'element-plus'
import zhCn from 'element-plus/es/locale/lang/zh-cn'
import App from './App.vue'
import { router } from './router'
import { installErrorHandlers } from './services/error-handler'
import { bootstrapStores } from './stores'
import { initTheme } from './theme'

// 首帧之前把主题定下来（不闪）
initTheme()

// 启动页的入口判断在 router/index.ts（必须在 createWebHashHistory 之前改 hash，
// 原因见那里的注释）

const app = createApp(App)
// 异常兜底要早于挂载：首屏渲染就出错的话，晚一步就什么都记不到了
installErrorHandlers(app)
app.use(createPinia()).use(ElementPlus, { locale: zhCn }).use(router).mount('#app')

// 挂载之后再拉数据 / 恢复会话：首屏用本地缓存先渲染，网络慢不阻塞界面。
// 两个 init 都不抛错（见 stores/index.ts），失败只影响"新不新"，不影响"能不能看"。
bootstrapStores()
