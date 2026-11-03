/**
 * 本机偏好 / 系统级能力（T10.1，D36）
 *
 * 注意：这里的偏好是**本机偏好**，不属于账号数据、不进快照、不上云。
 */

/** 关闭主窗口时的行为 */
export type CloseAction =
  /** 窗口隐藏，程序留在托盘继续跑（默认） */
  | 'tray'
  /** 直接退出程序 */
  | 'quit'

export interface AppPreferences {
  /** 关闭窗口时怎么办 */
  closeAction: CloseAction
  /** 开机自启（T10.2 用；仅在安装包里生效） */
  openAtLogin: boolean
  /**
   * 是否已经提示过"已最小化到托盘"
   *
   * 只提示一次：天天弹就成了骚扰。
   */
  trayHintShown: boolean
}

export interface SystemApi {
  prefs: () => Promise<AppPreferences>
  /** 只传要改的字段；返回合并后的完整偏好 */
  setPrefs: (patch: Partial<AppPreferences>) => Promise<AppPreferences>
  /** 托盘菜单点了「打开设置」：主进程推过来的跳转指令 */
  onNavigate: (callback: (path: string) => void) => () => void
}
