<script setup lang="ts">
import { GLYPHS, type IconName } from '@renderer/icons'

withDefaults(defineProps<{ name: IconName; size?: string }>(), {
  size: '1.25rem'
})
</script>

<template>
  <i
    class="app-icon"
    :class="`icon-${GLYPHS[name]}`"
    :style="{ fontSize: size }"
    aria-hidden="true"
  />
</template>

<style scoped>
.app-icon {
  display: inline-block;
  font-family: 'snooker-icon';
  font-style: normal;
  font-weight: normal;
  line-height: 1;
  text-align: center;
  /* 颜色一律继承 currentColor，这样主题切换和激活态都不用额外写样式 */
  color: inherit;
  -webkit-font-smoothing: antialiased;
  -moz-osx-font-smoothing: grayscale;
}
</style>
