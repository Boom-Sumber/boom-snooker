import 'element-plus/dist/index.css'
import 'element-plus/theme-chalk/dark/css-vars.css'
import './styles/theme.css'
import './assets/main.css'

import { createApp } from 'vue'
import ElementPlus from 'element-plus'
import zhCn from 'element-plus/es/locale/lang/zh-cn'
import App from './App.vue'
import { router } from './router'
import { initTheme } from './theme'

// 首帧之前把主题定下来（不闪）
initTheme()

createApp(App).use(ElementPlus, { locale: zhCn }).use(router).mount('#app')
