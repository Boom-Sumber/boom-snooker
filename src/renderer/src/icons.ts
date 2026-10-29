/**
 * 图标语义名 → iconfont 里的拼音类名
 *
 * 代码里只写 name="home" 这种语义名，拼音收敛在这张表里；
 * 以后换图标集（换成 SVG 组件或别的字体）只改这里和 AppIcon.vue。
 */
export const GLYPHS = {
  logo: 'taiqiu1',
  home: 'shouye',
  balls: 'taiqiuganh',
  advanced: 'jinjie-copy',
  more: 'qita',
  sun: 'sun',
  moon: 'moon',
  minimize: 'zuixiaohua',
  maximize: 'zuidahua',
  restore: 'chuangkouhuanyuan',
  close: 'guanbi',
  /** 备用图标（暂时没用） */
  spare: 'siluoketaiqiu'
} as const

export type IconName = keyof typeof GLYPHS

/**
 * 视觉尺寸补偿
 *
 * 字体图标各自的内边距不一样：同样 font-size 下，图形占满 em 框的看起来就大，
 * 图形只占一小块的看起来就小。这里按「肉眼大小」做补偿，1 = 不调整。
 *
 * 只写需要调的，没写的按 1 处理。
 */
export const GLYPH_SCALES: Partial<Record<IconName, number>> = {
  // 球杆图形在字形里留白多，看起来偏小
  balls: 1.2,
  // 箭头图形更小，需要再多放大一点
  advanced: 1.3,
  // 四方格图形几乎占满 em 框，看起来偏大
  more: 0.85,
  // 太阳/月亮图形留白多，18px 下比旁边的铃铛明显小一圈
  sun: 1.15,
  moon: 1.15
}

/** 按补偿系数算出实际字号，给 AppIcon 的 size 用 */
export function iconSize(name: IconName, base = '1.25rem'): string {
  const scale = GLYPH_SCALES[name] ?? 1
  return scale === 1 ? base : `calc(${base} * ${scale})`
}
