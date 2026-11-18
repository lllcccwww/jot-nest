import { app, BrowserWindow, Menu, protocol } from 'electron'
import { EVENTS } from '@shared/ipc'
import { BackupService } from './backup'
import { disposeIpc, registerIpc, resolveJotResource } from './ipc'
import { disposeShortcuts, initShortcut } from './shortcut'
import { BoardStore } from './store/board'
import { closeDatabase, openDatabase } from './store/db'
import { applyAutoLaunch, getSettings } from './store/settings'
import { createTray, destroyTray, updateTrayBackup } from './tray'
import { initUpdater } from './updater'
import { createCaptureWindow, createMainWindow, setQuitting, showMainWindow } from './windows'

app.setAppUserModelId('com.linchengwei.jot')

// 测试/多实例隔离：允许通过环境变量或启动参数指定独立的数据目录
const argUserData = process.argv.find((arg) => arg.startsWith('--user-data='))?.slice('--user-data='.length)
const customUserData = argUserData || process.env.JOT_USER_DATA
if (customUserData) app.setPath('userData', customUserData)

protocol.registerSchemesAsPrivileged([
  {
    scheme: 'jot',
    privileges: { standard: true, secure: true, supportFetchAPI: true, stream: true, bypassCSP: false }
  }
])

const gotLock = app.requestSingleInstanceLock()
if (!gotLock) {
  app.quit()
} else {
  app.on('second-instance', () => {
    showMainWindow()
  })

  app.whenReady().then(() => {
    Menu.setApplicationMenu(null)
    openDatabase()
    const store = new BoardStore()
    const backup = new BackupService(store)

    protocol.handle('jot', async (request) => {
      const url = new URL(request.url)
      const kind = url.hostname
      const id = url.pathname.replace(/^\//, '')
      const resource = resolveJotResource(kind, id)
      if (!resource) return new Response('not found', { status: 404 })
      return new Response(resource.body, {
        status: 200,
        headers: {
          'content-type': resource.mime,
          'cache-control': 'public, max-age=31536000, immutable'
        }
      })
    })

    registerIpc({
      store,
      backup,
      onBackupState: () => {
        updateTrayBackup(backup.getState(), { onBackupNow: () => void backup.runNow() })
      },
      onShortcutChanged: () => {
        initShortcut()
        for (const window of BrowserWindow.getAllWindows()) {
          if (!window.isDestroyed()) window.webContents.send(EVENTS.settingsChanged, getSettings())
        }
      }
    })

    backup.onState((state) => {
      updateTrayBackup(state, { onBackupNow: () => void backup.runNow() })
      for (const window of BrowserWindow.getAllWindows()) {
        if (!window.isDestroyed()) window.webContents.send(EVENTS.backupState, state)
      }
    })

    createMainWindow()
    createCaptureWindow()
    createTray({ onBackupNow: () => void backup.runNow() })
    initShortcut()
    applyAutoLaunch(getSettings().autoLaunch)
    initUpdater()

    setTimeout(() => {
      void backup.runNow()
    }, 60_000)
  })

  app.on('window-all-closed', () => {
    // 托盘常驻应用：关掉窗口不退出
  })

  app.on('before-quit', () => {
    setQuitting()
    disposeShortcuts()
    disposeIpc()
    destroyTray()
    closeDatabase()
  })

  app.on('activate', () => {
    showMainWindow()
  })
}

// 避免渲染进程静默崩溃时无声退出
process.on('uncaughtException', (error) => {
  console.error('[jot] uncaught exception', error)
})
