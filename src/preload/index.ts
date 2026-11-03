import { contextBridge, ipcRenderer } from 'electron'
import { electronAPI } from '@electron-toolkit/preload'
import type { AppInfoApi } from '@shared/types/app'
import type { AuthVaultApi } from '@shared/types/auth'
import type { LogApi, LogLevel } from '@shared/types/log'
import type { CacheFileInfo, LocalStoreApi } from '@shared/types/storage'
import type { AppPreferences, AutoStartState, SystemApi } from '@shared/types/system'
import type { MediaApi, MediaCacheStats, PrefetchProgress } from '@shared/types/media'
import type { ThemeApi, ThemeMode, ThemeState } from '@shared/types/theme'
import type { WindowControls } from '@shared/types/window'

// 自定义 API：渲染进程只能通过这里访问主进程能力，不直接碰 Node
const api: {
  theme: ThemeApi
  windowControls: WindowControls
  auth: AuthVaultApi
  store: LocalStoreApi
  app: AppInfoApi
  log: LogApi
  system: SystemApi
  media: MediaApi
} = {
  app: {
    info: () => ipcRenderer.invoke('app:info')
  },
  system: {
    prefs: (): Promise<AppPreferences> => ipcRenderer.invoke('prefs:get'),
    setPrefs: (patch: Partial<AppPreferences>): Promise<AppPreferences> =>
      ipcRenderer.invoke('prefs:set', patch),
    /** 托盘菜单「打开设置」：主进程推路由，渲染层跟着跳 */
    onNavigate: (callback: (path: string) => void): (() => void) => {
      const handler = (_event: Electron.IpcRendererEvent, path: string): void => callback(path)
      ipcRenderer.on('app:navigate', handler)
      return () => ipcRenderer.removeListener('app:navigate', handler)
    },
    autostart: {
      get: (): Promise<AutoStartState> => ipcRenderer.invoke('autostart:get'),
      set: (enabled: boolean): Promise<AutoStartState> =>
        ipcRenderer.invoke('autostart:set', enabled)
    }
  },
  media: {
    stats: (): Promise<MediaCacheStats> => ipcRenderer.invoke('media:stats'),
    prefetch: (paths: string[]) => ipcRenderer.invoke('media:prefetch', paths),
    cancelPrefetch: (): Promise<void> => ipcRenderer.invoke('media:prefetch-cancel'),
    clear: (): Promise<MediaCacheStats> => ipcRenderer.invoke('media:clear'),
    onProgress: (callback: (progress: PrefetchProgress) => void): (() => void) => {
      const handler = (_event: Electron.IpcRendererEvent, progress: PrefetchProgress): void =>
        callback(progress)
      ipcRenderer.on('media:prefetch-progress', handler)
      return () => ipcRenderer.removeListener('media:prefetch-progress', handler)
    }
  },
  log: {
    // 用 send 不用 invoke：日志是"记一笔就走"，不该让业务等回执
    write: (level: LogLevel, scope: string, message: string, detail?: string): void =>
      ipcRenderer.send('log:write', level, scope, message, detail),
    path: (): Promise<string> => ipcRenderer.invoke('log:path'),
    open: (): Promise<void> => ipcRenderer.invoke('log:open')
  },
  theme: {
    get: (): Promise<ThemeState> => ipcRenderer.invoke('theme:get'),
    set: (mode: ThemeMode): Promise<ThemeState> => ipcRenderer.invoke('theme:set', mode)
  },
  auth: {
    get: (key: string): Promise<string | null> => ipcRenderer.invoke('auth:get', key),
    set: (key: string, value: string): Promise<void> => ipcRenderer.invoke('auth:set', key, value),
    remove: (key: string): Promise<void> => ipcRenderer.invoke('auth:remove', key),
    clear: (): Promise<void> => ipcRenderer.invoke('auth:clear'),
    isEncryptionAvailable: (): Promise<boolean> => ipcRenderer.invoke('auth:encryption-available')
  },
  store: {
    read: (name: string): Promise<string | null> => ipcRenderer.invoke('store:read', name),
    write: (name: string, content: string): Promise<void> =>
      ipcRenderer.invoke('store:write', name, content),
    remove: (name: string): Promise<void> => ipcRenderer.invoke('store:remove', name),
    stat: (name: string): Promise<CacheFileInfo | null> => ipcRenderer.invoke('store:stat', name)
  },
  windowControls: {
    minimize: (): void => ipcRenderer.send('window:minimize'),
    toggleMaximize: (): void => ipcRenderer.send('window:toggle-maximize'),
    close: (): void => ipcRenderer.send('window:close'),
    isMaximized: (): Promise<boolean> => ipcRenderer.invoke('window:is-maximized'),
    onMaximizeChanged: (callback: (maximized: boolean) => void): (() => void) => {
      const handler = (_event: Electron.IpcRendererEvent, maximized: boolean): void =>
        callback(maximized)
      ipcRenderer.on('window:maximize-changed', handler)
      return () => ipcRenderer.removeListener('window:maximize-changed', handler)
    }
  }
}

// Use `contextBridge` APIs to expose Electron APIs to
// renderer only if context isolation is enabled, otherwise
// just add to the DOM global.
if (process.contextIsolated) {
  try {
    contextBridge.exposeInMainWorld('electron', electronAPI)
    contextBridge.exposeInMainWorld('api', api)
  } catch (error) {
    console.error(error)
  }
} else {
  // @ts-ignore (define in dts)
  window.electron = electronAPI
  // @ts-ignore (define in dts)
  window.api = api
}
