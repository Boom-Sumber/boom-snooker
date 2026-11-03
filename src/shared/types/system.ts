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

export interface AutoStartState {
  /** 当前是否随系统启动（以系统返回为准，不是我们记的值） */
  enabled: boolean
  /** 当前环境是否支持（只有安装包支持，dev 下为 false） */
  supported: boolean
}

export interface SystemApi {
  prefs: () => Promise<AppPreferences>
  /** 只传要改的字段；返回合并后的完整偏好 */
  setPrefs: (patch: Partial<AppPreferences>) => Promise<AppPreferences>
  /** 托盘菜单点了「打开设置」：主进程推过来的跳转指令 */
  onNavigate: (callback: (path: string) => void) => () => void
  autostart: {
    get: () => Promise<AutoStartState>
    set: (enabled: boolean) => Promise<AutoStartState>
  }
  /**
   * 真正退出程序（不是"关闭窗口"）
   *
   * 关闭行为为"最小化到托盘"时，窗口的 close 会被主进程拦下来，
   * 所以强制更新弹窗里的「退出程序」必须走这条独立的 IPC。
   */
  quit: () => Promise<void>
}
