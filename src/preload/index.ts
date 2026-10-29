import { contextBridge, ipcRenderer } from 'electron'
import { electronAPI } from '@electron-toolkit/preload'
import type { ThemeApi, ThemeMode, ThemeState } from '@shared/types/theme'
import type { WindowControls } from '@shared/types/window'

// 自定义 API：渲染进程只能通过这里访问主进程能力，不直接碰 Node
const api: { theme: ThemeApi; windowControls: WindowControls } = {
  theme: {
    get: (): Promise<ThemeState> => ipcRenderer.invoke('theme:get'),
    set: (mode: ThemeMode): Promise<ThemeState> => ipcRenderer.invoke('theme:set', mode)
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
