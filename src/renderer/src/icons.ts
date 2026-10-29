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
