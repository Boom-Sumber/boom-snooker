<script setup lang="ts">
/**
 * 根组件只做两件事：路由出口 + 全局唯一的那几个"跨页面"组件。
 *
 * 强制更新弹窗挂在根上而不是 MainLayout 里：启动页/登录页同样可能要求更新，
 * 挂在布局里的话那几个页面就漏掉了。
 */
import UpdateDialog from '@renderer/components/UpdateDialog.vue'
</script>

<template>
  <!-- 布局在路由里（MainLayout），这里只做出口 -->
  <RouterView />
  <UpdateDialog />
</template>
