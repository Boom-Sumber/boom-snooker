import './styles/theme.css'
import './assets/main.css'

import { createApp } from 'vue'
import App from './App.vue'
import { initTheme } from './theme'

// 首帧之前把主题定下来（不闪）
initTheme()

createApp(App).mount('#app')
