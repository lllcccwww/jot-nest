import { app } from 'electron'
import { autoUpdater } from 'electron-updater'
import { getSettings } from './store/settings'

let initialized = false

export function initUpdater(): void {
  if (!app.isPackaged || initialized) return
  const { updateFeedUrl, autoUpdate } = getSettings()
  if (!updateFeedUrl) return
  initialized = true
  try {
    autoUpdater.setFeedURL({ provider: 'generic', url: updateFeedUrl })
    autoUpdater.autoDownload = true
    autoUpdater.autoInstallOnAppQuit = true
    autoUpdater.on('error', (error) => {
      console.warn('[jot] 更新检查失败：', error.message)
    })
    if (autoUpdate) {
      setTimeout(() => {
        void autoUpdater.checkForUpdates().catch(() => undefined)
      }, 20_000)
    }
  } catch (error) {
    console.warn('[jot] 自动更新初始化失败：', error)
  }
}
