/**
 * 窗口控制（无边框窗口的自绘标题栏要用）
 *
 * 主进程持有 BrowserWindow，渲染进程只能通过这组方法操作，不直接碰 Electron。
 */
export interface WindowControls {
  minimize(): void
  toggleMaximize(): void
  close(): void
  /** 当前是否最大化（用于首次渲染时定图标） */
  isMaximized(): Promise<boolean>
  /**
   * 订阅最大化状态变化（最大化 / 还原 / 全屏切换）
   * @returns 取消订阅函数
   */
  onMaximizeChanged(callback: (maximized: boolean) => void): () => void
}
