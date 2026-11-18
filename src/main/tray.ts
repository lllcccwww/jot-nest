import { app, Menu, Tray, nativeImage } from 'electron'
import { existsSync } from 'node:fs'
import { join } from 'node:path'
import type { BackupState } from '@shared/types'
import { openCaptureWindow, setQuitting, showMainWindow } from './windows'

let tray: Tray | null = null
let lastBackup: BackupState = { status: 'idle' }

function trayIconPath(): string {
  const candidates = [
    join(__dirname, '../../resources/tray.png'),
    join(process.resourcesPath ?? '', 'tray.png'),
    join(app.getAppPath(), 'resources', 'tray.png')
  ]
  for (const candidate of candidates) {
    if (existsSync(candidate)) return candidate
  }
  return ''
}

function backupLabel(state: BackupState): string {
  switch (state.status) {
    case 'syncing':
      return '备份中…'
    case 'ok':
      return `已备份 ${state.at ? new Date(state.at).toLocaleTimeString() : ''}`.trim()
    case 'error':
      return `备份失败：${state.message ?? '未知错误'}`
    case 'disabled':
      return '未配置 COS 备份'
    default:
      return '等待备份'
  }
}

export function createTray(handlers: { onBackupNow: () => void }): void {
  if (tray) return
  const iconPath = trayIconPath()
  const image = iconPath ? nativeImage.createFromPath(iconPath) : nativeImage.createEmpty()
  tray = new Tray(image.isEmpty() ? nativeImage.createEmpty() : image.resize({ width: 16, height: 16 }))
  tray.setToolTip('Jot — 随手记')
  tray.on('click', () => {
    showMainWindow()
  })
  refreshTray(handlers)
}

export function refreshTray(handlers: { onBackupNow: () => void }): void {
  if (!tray) return
  const menu = Menu.buildFromTemplate([
    { label: '捕捉一条', accelerator: 'Enter', click: () => openCaptureWindow() },
    { label: '打开 Jot', click: () => showMainWindow() },
    { type: 'separator' },
    { label: backupLabel(lastBackup), enabled: false },
    { label: '立即备份', click: () => handlers.onBackupNow() },
    { type: 'separator' },
    {
      label: '退出',
      click: () => {
        setQuitting()
        app.quit()
      }
    }
  ])
  tray.setContextMenu(menu)
}

export function updateTrayBackup(state: BackupState, handlers: { onBackupNow: () => void }): void {
  lastBackup = state
  refreshTray(handlers)
}

export function destroyTray(): void {
  tray?.destroy()
  tray = null
}
