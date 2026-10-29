<script setup lang="ts">
import { computed } from 'vue'
import PagePlaceholder from '@renderer/components/PagePlaceholder.vue'
import { BALL_LABELS } from '@renderer/navigation/menu'

const props = defineProps<{ color: string }>()

const label = computed(() => BALL_LABELS[props.color] ?? props.color)
</script>

<template>
  <PagePlaceholder
    :title="`${label} · 彩球打法`"
    description="6 个袋口 radio + 进袋方式下拉（联动）+ 卡片列表（力度大字 / 作者 / 时间 / 方法 / 高低杆 / 备注 / 3 张图 + 大图预览）。"
    task="T3.2 · 彩球列表页"
  />
</template>
