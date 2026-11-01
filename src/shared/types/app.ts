/**
 * 应用信息（版本 / Electron / Chromium / Node / 平台）
 *
 * 由主进程 `app:info` 提供 —— 渲染进程拿不到 `app.getVersion()`，
 * 也不该把版本号写死在代码或文案里（一升级就过期）。
 */
export interface AppInfo {
  /** 应用版本（package.json 的 version） */
  version: string
  electron: string
  chrome: string
  node: string
  /** 'win32' / 'darwin' / 'linux' */
  platform: string
}

export interface AppInfoApi {
  info: () => Promise<AppInfo>
}
