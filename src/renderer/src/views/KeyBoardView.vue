<script setup lang="ts">
/**
 * 小键盘设置（T3.7）
 *
 * 内容完全对应旧版 `Views/KeyBoardView.xaml`：两套系统、各 5 / 3 步，
 * 每步一句说明 + 一张截图。截图已从旧项目拷到 `assets/keyboard/<system>/`。
 *
 * 图片用 `import.meta.glob` 收集，按 `N.png` 的约定对应步骤：
 *   · 以后换图只要同名覆盖，不用改代码
 *   · 某张图缺失时该步显示「截图待补」，而不是整步消失（步骤数是固定的）
 */
import { computed, ref } from 'vue'
import { KEYBOARD_GROUPS, type KeyboardSystem } from '@renderer/content/keyboard'

const current = ref<KeyboardSystem>('win10')

/** 目录里的所有截图：key 形如 '../assets/keyboard/win10/1.png' */
const modules = import.meta.glob<string>('../assets/keyboard/*/*.{png,jpg,jpeg,webp}', {
  eager: true,
  import: 'default'
})

/** system/index → 图片地址 */
const imageMap = computed(() => {
  const map = new Map<string, string>()
  for (const [path, src] of Object.entries(modules)) {
    const match = path.match(/keyboard\/(win10|win7)\/(\d+)\./i)
    if (!match) continue
    map.set(`${match[1].toLowerCase()}/${Number(match[2])}`, src)
  }
  return map
})

const group = computed(
  () => KEYBOARD_GROUPS.find((item) => item.key === current.value) ?? KEYBOARD_GROUPS[0]
)

/** 当前系统的截图（给 el-image 的预览列表用） */
const previewList = computed(() =>
  group.value.steps
    .map((step) => imageMap.value.get(`${group.value.key}/${step.index}`))
    .filter((src): src is string => Boolean(src))
)

function imageOf(step: number): string | undefined {
  return imageMap.value.get(`${group.value.key}/${step}`)
}

/** 预览起始位置：缺图时 previewList 的下标会错位，所以按"当前是第几张有效图"算 */
function previewIndex(step: number): number {
  const src = imageOf(step)
  return src ? previewList.value.indexOf(src) : 0
}
</script>

<template>
  <section class="keyboard">
    <header class="head">
      <div>
        <h1 class="head__title">小键盘设置</h1>
        <p class="head__sub">
          本程序的数据都基于小键盘操作，先把系统的「鼠标键」打开。按自己的系统版本看下面的步骤。
        </p>
      </div>
      <el-radio-group v-model="current">
        <el-radio-button v-for="item in KEYBOARD_GROUPS" :key="item.key" :value="item.key">
          {{ item.label }}
        </el-radio-button>
      </el-radio-group>
    </header>

    <p class="head__hint">{{ group.hint }}</p>

    <ol class="steps">
      <li v-for="step in group.steps" :key="step.index" class="card step">
        <div class="step__head">
          <span class="step__no">{{ step.index }}</span>
          <p class="step__title">{{ step.title }}</p>
        </div>

        <el-image
          v-if="imageOf(step.index)"
          :src="imageOf(step.index)"
          fit="contain"
          :preview-src-list="previewList"
          :initial-index="previewIndex(step.index)"
          preview-teleported
          class="step__img"
        />
        <div v-else class="step__missing">
          这张截图待补（<code>{{ group.key }}/{{ step.index }}.png</code>）
        </div>
      </li>
    </ol>
  </section>
</template>

<style scoped>
.keyboard {
  display: flex;
  flex-direction: column;
  gap: 0.75rem;
  padding: clamp(16px, 2.2vw, 28px);
}

.head {
  display: flex;
  gap: 1rem;
  align-items: flex-start;
  justify-content: space-between;
  flex-wrap: wrap;
}

.head__title {
  margin: 0;
  font-size: clamp(1.25rem, 1.6vw, 1.5rem);
  font-weight: 500;
  color: var(--text-1);
}

.head__sub {
  margin: 0.25rem 0 0;
  font-size: var(--font-size-sm);
  line-height: 1.8;
  color: var(--text-2);
}

.head__hint {
  margin: 0;
  font-size: var(--font-size-sm);
  color: var(--text-3);
}

.steps {
  display: flex;
  flex-direction: column;
  gap: 0.75rem;
  margin: 0;
  padding: 0;
  list-style: none;
}

.step {
  padding: clamp(0.75rem, 1.4vw, 1.25rem);
}

.step__head {
  display: flex;
  gap: 0.625rem;
  align-items: baseline;
}

/* 步骤号做成圆形徽标，扫一眼就知道进行到第几步 */
.step__no {
  flex: none;
  width: 1.5rem;
  height: 1.5rem;
  font-size: var(--font-size-sm);
  font-variant-numeric: tabular-nums;
  line-height: 1.5rem;
  color: #fff;
  text-align: center;
  background: var(--primary);
  border-radius: 50%;
}

.step__title {
  margin: 0;
  font-size: var(--font-size-base);
  line-height: 1.7;
  color: var(--text-1);
}

/* 截图宽度自适应；点开看原图 */
.step__img {
  display: block;
  width: 100%;
  margin-top: 0.75rem;
  border-radius: var(--radius-sm);
}

.step__missing {
  margin-top: 0.75rem;
  padding: 1.5rem;
  font-size: var(--font-size-sm);
  color: var(--text-3);
  text-align: center;
  background: var(--surface-2);
  border-radius: var(--radius-sm);
}

.step__missing code {
  padding: 0 0.25rem;
  background: var(--surface-1);
  border-radius: 4px;
}
</style>
