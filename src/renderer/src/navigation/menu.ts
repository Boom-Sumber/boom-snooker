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
  /**
   * 只对哪些角色可见（不写 = 所有人可见）
   *
   * ⚠️ 这只是"看不见"，**不是"进不去"** —— 直接改 hash 仍能打开页面。
   * 真正的门槛是 `router` 的 `meta.roles` 守卫 + 服务端 RPC 校验，三层都要有。
   */
  roles?: Array<'viewer' | 'advanced' | 'admin' | 'superadmin'>
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
    items: [
      // 通知：审核结果 + 系统通知的历史（T4.9）
      { label: '通知', path: '/notifications' },
      // 我的投稿（T4.12）：待审 / 驳回的记录不在快照里，作者只能从这里看
      {
        label: '我的投稿',
        path: '/my-submissions',
        roles: ['viewer', 'advanced', 'admin', 'superadmin']
      },
      // 用户资料和顶栏头像菜单指向同一页（旧版也是两处入口）
      { label: '用户资料', path: '/account' },
      { label: '小键盘设置', path: '/keyboard' },
      { label: '系统设置', path: '/settings' },
      // 账户管理：只有管理员和超管看得见（D28）
      { label: '账户管理', path: '/users', roles: ['admin', 'superadmin'] },
      // 文案管理：只有超管（D31）
      { label: '文案管理', path: '/content', roles: ['superadmin'] },
      // 回收站：只有超管（T7.2），停用账号隐藏的内容不在这里
      { label: '回收站', path: '/recycle', roles: ['superadmin'] }
    ]
  }
]

/**
 * 按角色过滤菜单
 *
 * 未登录（`anon`）只看到不带 `roles` 的项；`admin` / `superadmin` 会多出「账户管理」。
 */
export function visibleNavGroups(role: string): NavGroup[] {
  return navGroups
    .map((group) => ({
      ...group,
      items: group.items.filter((item) => !item.roles || item.roles.includes(role as never))
    }))
    .filter((group) => group.items.length > 0)
}

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
