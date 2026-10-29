import { ElectronAPI } from '@electron-toolkit/preload'
import type { ThemeApi } from '@shared/types/theme'
import type { WindowControls } from '@shared/types/window'

declare global {
  interface Window {
    electron: ElectronAPI
    api: {
      theme: ThemeApi
      windowControls: WindowControls
    }
  }
}
