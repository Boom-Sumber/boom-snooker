#!/usr/bin/env node
/**
 * 图标生成（T6.3 前置）：1024 PNG -> 多尺寸 ICO + 应用图标 + 托盘图标
 *
 * 为什么用 Electron 而不是 ImageMagick / png2ico：
 *   这台机器上没有装那些工具，装一个只为转格式不值当。Electron 自带 nativeImage，
 *   缩放质量（quality: 'best'）够用，而且**跑的就是应用本身那个渲染栈** ——
 *   生成出来的小尺寸跟界面上看到的缩略效果一致。
 *
 * 用法（必须在项目根目录）：
 *   npx electron scripts/make-icons.js
 *
 * 产出：
 *   build/icon.ico        7 档：16 / 24 / 32 / 48 / 64 / 128 / 256
 *                         （16~64 用 BMP，128/256 用 PNG —— 与 Windows 的惯例一致）
 *   build/icon.png        1024，electron-builder 的兜底图标
 *   resources/tray.png    32，系统托盘专用（托盘只有 16~24 逻辑像素，必须单独给小图）
 */
const { app, nativeImage } = require('electron')
const fs = require('fs')
const path = require('path')

const ROOT = path.resolve(__dirname, '..')
const SRC = path.join(ROOT, 'build', 'Snooker2D_1024x1024.png')

/** 小尺寸用 BMP（兼容性最好），大尺寸用 PNG（体积小，Vista+ 支持） */
const BMP_SIZES = [16, 24, 32, 48, 64]
const PNG_SIZES = [128, 256]

/**
 * 把一张 BGRA 位图编码成 ICO 里的 DIB 条目
 *
 * 两个关键点：
 *   1. **高度写两倍**：ICO 的 DIB 是"XOR 图 + AND 掩码"叠在一起，`biHeight = h * 2`
 *   2. **要去预乘**：Chromium 的位图是预乘 alpha 的（c 已经乘过 a/255），
 *      直接写进去，半透明边缘会被 Windows 当成"已经是最终颜色"再合成一次 —— 结果是
 *      球边缘出现一圈脏边。按 `c * 255 / a` 还原成直通 alpha。
 *      全透明像素直接写 0，避免除零。
 */
function encodeDib(size, bitmap) {
  const header = Buffer.alloc(40)
  header.writeUInt32LE(40, 0) // biSize
  header.writeInt32LE(size, 4) // biWidth
  header.writeInt32LE(size * 2, 8) // biHeight（XOR + AND）
  header.writeUInt16LE(1, 12) // biPlanes
  header.writeUInt16LE(32, 14) // biBitCount
  header.writeUInt32LE(0, 16) // biCompression = BI_RGB
  header.writeUInt32LE(size * size * 4, 20) // biSizeImage
  header.writeInt32LE(0, 24)
  header.writeInt32LE(0, 28)
  header.writeUInt32LE(0, 32)
  header.writeUInt32LE(0, 36)

  const pixels = Buffer.alloc(size * size * 4)
  for (let y = 0; y < size; y++) {
    // DIB 是自下而上存的
    const srcRow = (size - 1 - y) * size * 4
    const dstRow = y * size * 4
    for (let x = 0; x < size; x++) {
      const s = srcRow + x * 4
      const d = dstRow + x * 4
      const a = bitmap[s + 3]
      if (a === 0) continue // 全透明：保持 0
      const un = (c) => (a === 255 ? c : Math.min(255, Math.round((c * 255) / a)))
      pixels[d] = un(bitmap[s]) // B
      pixels[d + 1] = un(bitmap[s + 1]) // G
      pixels[d + 2] = un(bitmap[s + 2]) // R
      pixels[d + 3] = a
    }
  }

  // AND 掩码：32 位图靠 alpha 通道，掩码全 0 即可，但字节必须存在且行按 4 字节对齐
  const maskRowBytes = Math.ceil(size / 32) * 4
  const mask = Buffer.alloc(maskRowBytes * size)

  return Buffer.concat([header, pixels, mask])
}

function buildIco(entries) {
  const count = entries.length
  const dir = Buffer.alloc(6)
  dir.writeUInt16LE(0, 0) // reserved
  dir.writeUInt16LE(1, 2) // type = icon
  dir.writeUInt16LE(count, 4)

  const table = Buffer.alloc(count * 16)
  let offset = 6 + count * 16

  entries.forEach((entry, index) => {
    const base = index * 16
    const size = entry.size
    table.writeUInt8(size >= 256 ? 0 : size, base) // 0 表示 256
    table.writeUInt8(size >= 256 ? 0 : size, base + 1)
    table.writeUInt8(0, base + 2) // 调色板数
    table.writeUInt8(0, base + 3) // reserved
    table.writeUInt16LE(1, base + 4) // planes
    table.writeUInt16LE(32, base + 6) // bpp
    table.writeUInt32LE(entry.data.length, base + 8)
    table.writeUInt32LE(offset, base + 12)
    offset += entry.data.length
  })

  return Buffer.concat([dir, table, ...entries.map((e) => e.data)])
}

app.whenReady().then(() => {
  if (!fs.existsSync(SRC)) {
    console.error(`找不到源图：${SRC}`)
    app.exit(1)
    return
  }

  const source = nativeImage.createFromPath(SRC)
  const { width, height } = source.getSize()
  if (width !== height) {
    console.error(`源图必须是正方形，当前 ${width}x${height}`)
    app.exit(1)
    return
  }
  console.log(`源图 ${width}x${height}`)

  const entries = []
  for (const size of [...BMP_SIZES, ...PNG_SIZES].sort((a, b) => a - b)) {
    const resized = source.resize({ width: size, height: size, quality: 'best' })
    const data = BMP_SIZES.includes(size)
      ? encodeDib(size, resized.toBitmap())
      : resized.toPNG()
    entries.push({ size, data })
  }

  const ico = buildIco(entries)
  fs.writeFileSync(path.join(ROOT, 'build', 'icon.ico'), ico)

  // electron-builder 的兜底 PNG：直接用 1024 源图，不重采样
  fs.copyFileSync(SRC, path.join(ROOT, 'build', 'icon.png'))

  // 托盘：32px。托盘在 100%~200% 缩放下只用 16~32 逻辑像素，
  // 用 1024 让系统缩会糊成一团，这里显式给一张
  const tray = source.resize({ width: 32, height: 32, quality: 'best' })
  fs.writeFileSync(path.join(ROOT, 'resources', 'tray.png'), tray.toPNG())

  // 运行时的大图（窗口图标 / 将来做关于页大 logo 都用它），256 足够
  const runtime = source.resize({ width: 256, height: 256, quality: 'best' })
  fs.writeFileSync(path.join(ROOT, 'resources', 'icon.png'), runtime.toPNG())

  console.log(
    `已生成 icon.ico（${entries.length} 档：${entries.map((e) => e.size).join('/')}，${(ico.length / 1024).toFixed(1)} KB）`
  )
  console.log('已生成 build/icon.png（1024）、resources/icon.png（256）、resources/tray.png（32）')
  app.exit(0)
})
