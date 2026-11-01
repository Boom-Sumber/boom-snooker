<script setup lang="ts">
/**
 * 图形验证码（注册时拦截脚本批量注册）
 *
 * 做法：canvas 画 4 位随机字符 + 随机旋转 + 干扰线/噪点，点一下换一张。
 *
 * ⚠️ 能力边界（写在代码里，免得以后误以为它是安全边界）：
 *   验证码是**纯客户端**生成的，字符存在内存里，脚本能直接读 DOM/内存绕过。
 *   它拦的是"随手写个循环狂点注册"的低成本脚本，不是有备而来的攻击。
 *   真正的服务端验证码要么上 hCaptcha/Turnstile，要么走 Edge Function ——
 *   D12 明确不做 Edge Function，免费方案里 Supabase Auth 自带速率限制兜底。
 */
import { onBeforeUnmount, onMounted, ref } from 'vue'

const emit = defineEmits<{ (event: 'change', code: string): void }>()

const canvasRef = ref<HTMLCanvasElement>()

/** 去掉容易看错的 0/O、1/I/L */
const CHARS = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789'
const LENGTH = 4

const code = ref('')

function randomCode(): string {
  let next = ''
  for (let i = 0; i < LENGTH; i += 1) {
    next += CHARS[Math.floor(Math.random() * CHARS.length)]
  }
  return next
}

/** 从主题变量取色，亮暗两套主题都能看清 */
function themeColor(name: string, fallback: string): string {
  const value = getComputedStyle(document.documentElement).getPropertyValue(name).trim()
  return value || fallback
}

function render(value: string): void {
  const canvas = canvasRef.value
  if (!canvas) return

  const dpr = window.devicePixelRatio || 1
  const width = canvas.clientWidth || 120
  const height = canvas.clientHeight || 44
  canvas.width = Math.round(width * dpr)
  canvas.height = Math.round(height * dpr)

  const ctx = canvas.getContext('2d')
  if (!ctx) return
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0)

  const bg = themeColor('--surface-2', '#f2f2f2')
  const ink = themeColor('--text-1', '#333333')
  const accent = themeColor('--primary', '#f06632')

  ctx.clearRect(0, 0, width, height)
  ctx.fillStyle = bg
  ctx.fillRect(0, 0, width, height)

  // 干扰线：3 条，颜色半透明，别盖住字
  for (let i = 0; i < 3; i += 1) {
    ctx.beginPath()
    ctx.strokeStyle = i % 2 === 0 ? `${ink}33` : `${accent}44`
    ctx.lineWidth = 1
    ctx.moveTo(Math.random() * width, Math.random() * height)
    ctx.bezierCurveTo(
      Math.random() * width,
      Math.random() * height,
      Math.random() * width,
      Math.random() * height,
      Math.random() * width,
      Math.random() * height
    )
    ctx.stroke()
  }

  // 噪点
  for (let i = 0; i < 28; i += 1) {
    ctx.beginPath()
    ctx.fillStyle = i % 3 === 0 ? `${accent}66` : `${ink}33`
    ctx.arc(Math.random() * width, Math.random() * height, Math.random() * 1.4, 0, Math.PI * 2)
    ctx.fill()
  }

  const step = width / (value.length + 1)
  for (let i = 0; i < value.length; i += 1) {
    const char = value[i]
    const x = step * (i + 1)
    const y = height / 2

    ctx.save()
    ctx.translate(x, y)
    // -0.35 ~ 0.35 弧度，够歪但不影响辨认
    ctx.rotate((Math.random() - 0.5) * 0.7)
    ctx.font = `600 ${Math.round(height * 0.52)}px ${themeColor('--font-family-base', 'sans-serif')}`
    ctx.textAlign = 'center'
    ctx.textBaseline = 'middle'
    ctx.fillStyle = i % 2 === 0 ? ink : accent
    ctx.fillText(char, 0, 0)
    ctx.restore()
  }
}

/** 换一张：新字符 + 重绘 + 通知父组件 */
function draw(): void {
  code.value = randomCode()
  render(code.value)
  emit('change', code.value)
}

function refresh(): void {
  draw()
}

/**
 * 主题切换时重绘同一张码（不换字符）
 *
 * canvas 画完就是一张位图，`html.dark` 变了它不会自己变 —— 不重绘的话，
 * 亮色主题下会留一块深色底。
 */
let themeObserver: MutationObserver | null = null

onMounted(() => {
  draw()
  themeObserver = new MutationObserver(() => render(code.value))
  themeObserver.observe(document.documentElement, { attributes: true, attributeFilter: ['class'] })
})

onBeforeUnmount(() => {
  themeObserver?.disconnect()
  themeObserver = null
})

defineExpose({ refresh })
</script>

<template>
  <button
    class="captcha"
    type="button"
    title="看不清？点一下换一张"
    aria-label="换一张验证码"
    @click="refresh"
  >
    <canvas ref="canvasRef" class="captcha__canvas" />
  </button>
</template>

<style scoped>
.captcha {
  flex: none;
  width: 7.5rem;
  height: 2.75rem;
  padding: 0;
  overflow: hidden;
  cursor: pointer;
  background: var(--surface-2);
  border: 1px solid var(--border);
  border-radius: var(--radius-sm);
}

.captcha__canvas {
  display: block;
  width: 100%;
  height: 100%;
}
</style>
