/**
 * 侧栏菜单结构（照旧版布局：分组 + 二级页面）
 *
 * code 与数据库 display_dict 对齐（kind=color / category），
 * 后面接快照数据时直接用 code 过滤，不做中文反查。
 */

export interface NavItem {
  label: string
  path: string
}

export interface NavGroup {
  key: string
  label: string
  /** 折叠状态下显示的字符 */
  short: string
  items: NavItem[]
}

/** 彩球 6 色：code → 中文 */
export const BALL_LABELS: Record<string, string> = {
  yellow: '黄球',
  green: '绿球',
  brown: '咖啡球',
  blue: '蓝球',
  pink: '粉球',
  black: '黑球'
}

/** 进阶 5 系列：code → 中文 */
export const CATEGORY_LABELS: Record<string, string> = {
  straight: '直线系列',
  kick: '翻袋系列',
  curve: '弧线系列',
  break: '破局系列',
  other: '其他系列'
}

export const navGroups: NavGroup[] = [
  {
    key: 'home',
    label: '主页',
    short: '主',
    items: [{ label: 'Home', path: '/' }]
  },
  {
    key: 'balls',
    label: '彩球',
    short: '彩',
    items: Object.entries(BALL_LABELS).map(([code, label]) => ({
      label,
      path: `/balls/${code}`
    }))
  },
  {
    key: 'advanced',
    label: '进阶',
    short: '进',
    items: Object.entries(CATEGORY_LABELS).map(([code, label]) => ({
      label,
      path: `/advanced/${code}`
    }))
  },
  {
    key: 'about',
    label: '关于',
    short: '关',
    items: [{ label: 'About', path: '/about' }]
  }
]

/** 找出某个路径属于哪个分组（用于自动展开 + 高亮） */
export function findGroupKeyByPath(path: string): string | undefined {
  return navGroups.find((group) => group.items.some((item) => item.path === path))?.key
}
