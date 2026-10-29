import { ElectronAPI } from '@electron-toolkit/preload'
import type { ThemeApi } from '@shared/types/theme'

declare global {
  interface Window {
    electron: ElectronAPI
    api: {
      theme: ThemeApi
    }
  }
}
