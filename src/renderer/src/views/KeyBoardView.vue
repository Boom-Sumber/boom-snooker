<script setup lang="ts">
/**
 * 小键盘设置（T3.7）
 *
 * 内容就是一组步骤截图，按系统版本分两套（Win10 / Win7）。
 *
 * 截图**不写死**在代码里：用 `import.meta.glob` 扫 `assets/keyboard/`，
 * 命名规则见那个目录的 README —— 以后补图 / 换图只要丢文件进去，不用改代码。
 * 目录为空时显示提示，不会白屏。
 */
import { computed, ref } from 'vue'

type SystemKey = 'win10' | 'win7'

const SYSTEMS: { value: SystemKey; label: string }[] = [
  { value: 'win10', label: 'Win10 / Win11' },
  { value: 'win7', label: 'Win7' }
]

const current = ref<SystemKey>('win10')

/** 目录里的所有图片（Vite 在构建时静态收集，运行时只是查表） */
const modules = import.meta.glob<string>('../assets/keyboard/*.{png,jpg,jpeg,webp}', {
  eager: true,
  import: 'default'
})

/** 按 `win10-1.png` 这种命名分组，并按数字排序 */
const images = computed(() => {
  const groups: Record<SystemKey, { src: string; index: number }[]> = { win10: [], win7: [] }

  for (const [path, src] of Object.entries(modules)) {
    const file = path.split('/').pop() ?? ''
    const match = file.match(/^(win10|win7)-(\d+)\./i)
    if (!match) continue
    groups[match[1].toLowerCase() as SystemKey].push({ src, index: Number(match[2]) })
  }

  for (const key of Object.keys(groups) as SystemKey[]) {
    groups[key].sort((a, b) => a.index - b.index)
  }
  return groups
})

const currentImages = computed(() => images.value[current.value])
</script>

<template>
  <section class="keyboard">
    <header class="head">
      <div>
        <h1 class="head__title">小键盘设置</h1>
        <p class="head__sub">本程序的数据都基于小键盘操作。按自己的系统版本看下面的设置步骤。</p>
      </div>
      <el-radio-group v-model="current">
        <el-radio-button v-for="item in SYSTEMS" :key="item.value" :value="item.value">
          {{ item.label }}
        </el-radio-button>
      </el-radio-group>
    </header>

    <div v-if="currentImages.length === 0" class="card empty">
      <p class="empty__title">这一步的截图还没放进来</p>
      <p class="empty__text">
        把截图按 <code>{{ current }}-1.png</code>、<code>{{ current }}-2.png</code> … 命名， 放进
        <code>src/renderer/src/assets/keyboard/</code>，页面会自动显示（不用改代码）。
      </p>
    </div>

    <div v-else class="shots">
      <figure v-for="(image, index) in currentImages" :key="image.src" class="card shot">
        <el-image
          :src="image.src"
          fit="contain"
          :preview-src-list="currentImages.map((item) => item.src)"
          :initial-index="index"
          preview-teleported
          class="shot__img"
        />
        <figcaption class="shot__caption">第 {{ index + 1 }} 步</figcaption>
      </figure>
    </div>
  </section>
</template>

<style scoped>
.keyboard {
  display: flex;
  flex-direction: column;
  gap: 0.875rem;
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
  color: var(--text-2);
}

.shots {
  display: flex;
  flex-direction: column;
  gap: 0.875rem;
}

.shot {
  padding: 0.75rem;
}

/* 截图宽度自适应，但不超过内容区；点击可看原图 */
.shot__img {
  display: block;
  width: 100%;
  border-radius: var(--radius-sm);
}

.shot__caption {
  margin-top: 0.5rem;
  font-size: var(--font-size-sm);
  color: var(--text-3);
  text-align: center;
}

.empty {
  padding: 2rem;
  text-align: center;
}

.empty__title {
  margin: 0;
  font-size: var(--font-size-lg);
  color: var(--text-1);
}

.empty__text {
  margin: 0.5rem 0 0;
  font-size: var(--font-size-sm);
  line-height: 1.9;
  color: var(--text-2);
}

.empty__text code {
  padding: 0 0.25rem;
  background: var(--surface-2);
  border-radius: 4px;
}
</style>
