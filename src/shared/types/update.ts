/**
 * 应用内更新（U2）
 *
 * 状态机只有一个真源：主进程 `src/main/updater.ts` 里的 `state`。
 * 渲染层不自己维护一份，只通过 `updater:state` / `onState` 读快照 —— 否则
 * "设置页说有新版、侧栏红点却没亮" 这类不一致会没完没了。
 *
 * 关于 `mandatory`：它**不是**由 electron-updater 决定的。清单（latest.yml）
 * 只描述"有什么版本"，策略（最低可用版本）放在同目录的 `policy.json`，
 * 由发布脚本一并写上去。拿不到策略时一律**按非强制处理**（fail-open）——
 * 宁可让用户用旧版，也不能因为一个拉不到的小文件把所有人锁在门外。
 */

/** 更新阶段。`unsupported` 只在 dev / 缺少更新配置时出现，其余都来自真实检查 */
export type UpdatePhase =
  | 'unsupported'
  | 'idle'
  | 'checking'
  | 'available'
  | 'not-available'
  | 'downloading'
  | 'downloaded'
  | 'error'

/** 精简后的版本信息（electron-updater 的 `UpdateInfo` 字段多且不稳定，不直接透传给渲染层） */
export interface UpdateInfoLite {
  version: string
  /** ISO 时间串，可能为 null */
  releaseDate: string | null
  /** 发布说明（取自 latest.yml 的 releaseNotes，通常为空） */
  notes: string | null
  /** 安装包字节数，取自 `files[0].size` */
  size: number | null
}

/** 下载进度（百分比已经过四舍五入到整数，渲染层直接显示即可） */
export interface UpdateProgress {
  percent: number
  transferred: number
  total: number
  bytesPerSecond: number
}

export interface UpdateState {
  phase: UpdatePhase
  /** 当前运行的版本（`app.getVersion()`） */
  currentVersion: string
  /** 线上的新版信息；`available` / `downloading` / `downloaded` 时非空 */
  info: UpdateInfoLite | null
  /** 仅 `downloading` 时有值 */
  progress: UpdateProgress | null
  /** 强制更新：当前版本 < `minSupportedVersion` */
  mandatory: boolean
  /** 线上要求的最低版本；`policy.json` 缺失时为 null */
  minSupportedVersion: string | null
  /** 最近一次失败原因；成功检查后清空 */
  error: string | null
  /** 最近一次检查完成的时间戳（ms），用于设置页显示"刚刚检查" */
  checkedAt: number | null
  /** `unsupported` 时说明原因，设置页直接展示 */
  unsupportedReason: string | null
}

export interface UpdaterApi {
  /** 读当前状态快照（打开设置页时先拉一次） */
  state: () => Promise<UpdateState>
  /** 手动检查（会把失败以 `error` 形式回给渲染层；自动检查失败只写日志） */
  check: () => Promise<UpdateState>
  /** 开始下载（`autoDownload=false`，必须用户点） */
  download: () => Promise<UpdateState>
  /** 取消下载，状态回到 available */
  cancel: () => Promise<UpdateState>
  /** 退出并安装（只对 downloaded 有效） */
  install: () => Promise<void>
  /** 订阅状态变化，返回取消订阅函数 */
  onState: (callback: (state: UpdateState) => void) => () => void
}
