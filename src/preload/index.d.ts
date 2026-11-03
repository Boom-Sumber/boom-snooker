import { ElectronAPI } from '@electron-toolkit/preload'
import type { AppInfoApi } from '@shared/types/app'
import type { AuthVaultApi } from '@shared/types/auth'
import type { LogApi } from '@shared/types/log'
import type { LocalStoreApi } from '@shared/types/storage'
import type { SystemApi } from '@shared/types/system'
import type { MediaApi } from '@shared/types/media'
import type { ThemeApi } from '@shared/types/theme'
import type { UpdaterApi } from '@shared/types/update'
import type { WindowControls } from '@shared/types/window'

declare global {
  interface Window {
    electron: ElectronAPI
    api: {
      theme: ThemeApi
      windowControls: WindowControls
      auth: AuthVaultApi
      store: LocalStoreApi
      app: AppInfoApi
      log: LogApi
      system: SystemApi
      media: MediaApi
      updater: UpdaterApi
    }
  }
}
