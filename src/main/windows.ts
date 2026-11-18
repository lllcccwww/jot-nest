import { join } from 'node:path'
import { BrowserWindow, screen } from 'electron'

const DEV_URL = process.env['ELECTRON_RENDERER_URL']
const PRELOAD = join(__dirname, '../preload/index.js')

let mainWindow: BrowserWindow | null = null
let captureWindow: BrowserWindow | null = null

export const CAPTURE_SIZE = { width: 600, height: 340 }

export function getMainWindow(): BrowserWindow | null {
  return mainWindow
}

export function getCaptureWindow(): BrowserWindow | null {
  return captureWindow
}

export function loadRenderer(window: BrowserWindow, page: 'index' | 'capture'): void {
  if (DEV_URL) {
    void window.loadURL(`${DEV_URL}/${page}.html`)
  } else {
    void window.loadFile(join(__dirname, `../renderer/${page}.html`))
  }
}

export function createMainWindow(): BrowserWindow {
  if (mainWindow && !mainWindow.isDestroyed()) return mainWindow
  mainWindow = new BrowserWindow({
    width: 1320,
    height: 860,
    minWidth: 900,
    minHeight: 600,
    show: false,
    frame: false,
    backgroundColor: '#F4F4F1',
    title: 'Jot',
    webPreferences: {
      preload: PRELOAD,
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
      spellcheck: false
    }
  })

  mainWindow.once('ready-to-show', () => {
    mainWindow?.show()
  })

  const emitState = (): void => {
    if (!mainWindow || mainWindow.isDestroyed()) return
    mainWindow.webContents.send('evt:window-state', {
      maximized: mainWindow.isMaximized(),
      focused: mainWindow.isFocused()
    })
  }
  mainWindow.on('maximize', emitState)
  mainWindow.on('unmaximize', emitState)
  mainWindow.on('focus', emitState)
  mainWindow.on('blur', emitState)

  mainWindow.on('close', (event) => {
    if ((globalThis as { __jotQuitting?: boolean }).__jotQuitting) return
    event.preventDefault()
    mainWindow?.hide()
  })

  mainWindow.on('closed', () => {
    mainWindow = null
  })

  mainWindow.webContents.setWindowOpenHandler(() => ({ action: 'deny' }))

  loadRenderer(mainWindow, 'index')
  return mainWindow
}

export function showMainWindow(): void {
  const win = createMainWindow()
  if (win.isMinimized()) win.restore()
  win.show()
  win.focus()
}

export function createCaptureWindow(): BrowserWindow {
  if (captureWindow && !captureWindow.isDestroyed()) return captureWindow

  captureWindow = new BrowserWindow({
    ...CAPTURE_SIZE,
    show: false,
    frame: false,
    transparent: true,
    resizable: false,
    movable: true,
    minimizable: false,
    maximizable: false,
    fullscreenable: false,
    skipTaskbar: true,
    alwaysOnTop: true,
    hasShadow: false,
    backgroundColor: '#00000000',
    webPreferences: {
      preload: PRELOAD,
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false
    }
  })

  captureWindow.setAlwaysOnTop(true, 'screen-saver')
  captureWindow.setVisibleOnAllWorkspaces(true)

  captureWindow.on('blur', () => {
    if (!(globalThis as { __jotQuitting?: boolean }).__jotQuitting) captureWindow?.hide()
  })

  captureWindow.on('closed', () => {
    captureWindow = null
  })

  loadRenderer(captureWindow, 'capture')
  return captureWindow
}

export function openCaptureWindow(): void {
  const win = createCaptureWindow()
  const display = screen.getDisplayNearestPoint(screen.getCursorScreenPoint())
  const area = display.workArea
  const x = Math.round(area.x + (area.width - CAPTURE_SIZE.width) / 2)
  const y = Math.round(area.y + area.height * 0.24)
  win.setPosition(x, y)
  win.show()
  win.focus()
  win.webContents.send('evt:capture-opened', {})
}

export function hideCaptureWindow(): void {
  captureWindow?.hide()
}

export function setQuitting(): void {
  ;(globalThis as { __jotQuitting?: boolean }).__jotQuitting = true
}
