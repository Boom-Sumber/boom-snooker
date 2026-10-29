<script setup lang="ts">
import { useRoute } from 'vue-router'
import PagePlaceholder from '@renderer/components/PagePlaceholder.vue'

const route = useRoute()
</script>

<template>
  <PagePlaceholder title="页面不存在" :description="`没有找到 ${route.fullPath} 对应的页面。`" />
</template>
