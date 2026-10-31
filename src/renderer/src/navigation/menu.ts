/**
 * 侧栏菜单结构（照旧版布局：分组 + 二级页面）
 *
 * code 与数据库 display_dict 对齐（kind=color / category），
 * 后面接快照数据时直接用 code 过滤，不做中文反查。
 */

import type { IconName } from '@renderer/icons'

export interface NavItem {
  label: string
  path: string
}

export interface NavGroup {
  key: string
  label: string
  /** 一级菜单图标（AppIcon 的语义名） */
  icon: IconName
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

/** 四级角色：code → 中文（与 docs/03 第 9 节的权限矩阵一致） */
export const ROLE_LABELS: Record<string, string> = {
  viewer: '普通用户',
  advanced: '高级用户',
  admin: '管理员',
  superadmin: '超级管理员',
  anon: '未登录'
}

export const navGroups: NavGroup[] = [
  {
    key: 'home',
    label: '主页',
    icon: 'home',
    items: [{ label: 'Home', path: '/' }]
  },
  {
    key: 'balls',
    label: '彩球',
    icon: 'balls',
    items: Object.entries(BALL_LABELS).map(([code, label]) => ({
      label,
      path: `/balls/${code}`
    }))
  },
  {
    key: 'advanced',
    label: '进阶',
    icon: 'advanced',
    items: Object.entries(CATEGORY_LABELS).map(([code, label]) => ({
      label,
      path: `/advanced/${code}`
    }))
  },
  {
    key: 'more',
    label: '更多',
    icon: 'more',
    items: [{ label: 'About', path: '/about' }]
  }
]

/** 找出某个路径属于哪个分组（用于自动展开 + 高亮） */
export function findGroupKeyByPath(path: string): string | undefined {
  return navGroups.find((group) => group.items.some((item) => matchesPath(path, item.path)))?.key
}

/**
 * 路径是否命中某个菜单项
 *
 * 详情页（`/advanced/break/<id>`）也要让对应菜单项保持高亮、所在分组保持展开，
 * 所以除了完全相等，还接受「菜单路径 + `/`」前缀。
 * 不能用裸 `startsWith(path)` —— `/advanced/break` 会误命中 `/advanced/breakfast`。
 */
export function matchesPath(routePath: string, itemPath: string): boolean {
  return routePath === itemPath || routePath.startsWith(`${itemPath}/`)
}
