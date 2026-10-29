<script setup lang="ts">
import { computed } from 'vue'
import PagePlaceholder from '@renderer/components/PagePlaceholder.vue'
import { CATEGORY_LABELS } from '@renderer/navigation/menu'

const props = defineProps<{ category: string }>()

const label = computed(() => CATEGORY_LABELS[props.category] ?? props.category)
</script>

<template>
  <PagePlaceholder
    :title="`${label} · 进阶`"
    description="5 个系列切换，单图 + 标题 / 描述 / 内容，增删改。"
    task="T3.4 · 进阶系列"
  />
</template>
