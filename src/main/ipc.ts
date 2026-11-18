import { BrowserWindow, app, clipboard, ipcMain, shell } from 'electron'
import { IPC, EVENTS } from '@shared/ipc'
import type {
  Camera,
  CaptureSubmitInput,
  CreateGroupInput,
  CreateNoteInput,
  GroupPatch,
  ImageSaveInput,
  NoteMove,
  NotePatch,
  SearchQuery,
  SettingsPatch
} from '@shared/types'
import type { BoardStore } from './store/board'
import type { BackupService } from './backup'
import { readOriginal, readThumb, saveImage, isValidImageId } from './store/images'
import { getSettings, patchSettings } from './store/settings'
import { probeShortcut, setShortcut } from './shortcut'
import { getCaptureWindow, getMainWindow, hideCaptureWindow, showMainWindow } from './windows'

function broadcast(channel: string, payload: unknown): void {
  for (const window of BrowserWindow.getAllWindows()) {
    if (!window.isDestroyed()) window.webContents.send(channel, payload)
  }
}

export interface IpcDeps {
  store: BoardStore
  backup: BackupService
  onBackupState: () => void
  onShortcutChanged: () => void
}

export function registerIpc(deps: IpcDeps): void {
  const { store, backup } = deps

  store.onChange(() => {
    broadcast(EVENTS.boardChanged, { at: Date.now() })
    backup.schedule()
  })

  ipcMain.handle(IPC.boardGet, () => store.snapshot())

  ipcMain.handle(IPC.noteCreate, (_event, input: CreateNoteInput) => store.createNote(input))

  ipcMain.handle(IPC.noteUpdate, (_event, id: string, patch: NotePatch) => store.updateNote(id, patch))

  ipcMain.handle(IPC.notesMove, (_event, items: NoteMove[]) => store.moveNotes(items))

  ipcMain.handle(IPC.notesDelete, (_event, ids: string[]) => store.deleteNotes(ids))

  ipcMain.handle(IPC.groupCreate, (_event, input: CreateGroupInput) => store.createGroup(input))

  ipcMain.handle(IPC.groupUpdate, (_event, id: string, patch: GroupPatch) => store.updateGroup(id, patch))

  ipcMain.handle(IPC.groupDelete, (_event, id: string, keepChildren: boolean) =>
    store.deleteGroup(id, keepChildren)
  )

  ipcMain.handle(IPC.groupMove, (_event, id: string, dx: number, dy: number) => store.moveGroup(id, dx, dy))

  ipcMain.handle(IPC.cameraSet, (_event, camera: Camera, viewport: { w: number; h: number }) =>
    store.setCamera(camera, viewport)
  )

  ipcMain.handle(IPC.search, (_event, query: SearchQuery) => store.search(query))

  ipcMain.handle(IPC.tagsList, () => store.tags())

  ipcMain.handle(IPC.imageSave, (_event, input: ImageSaveInput) => saveImage(input))

  ipcMain.handle(IPC.clipboardImage, async () => {
    try {
      const items = await clipboard.read()
      for (const item of items) {
        const type = item.types.find((value) => value.startsWith('image/'))
        if (!type) continue
        const payload = await item.getType(type)
        if (!(payload instanceof Blob)) continue
        const buffer = Buffer.from(await payload.arrayBuffer())
        return `data:${type};base64,${buffer.toString('base64')}`
      }
    } catch {
      return null
    }
    return null
  })

  ipcMain.handle(IPC.settingsGet, () => getSettings())

  ipcMain.handle(IPC.settingsPatch, (_event, patch: SettingsPatch) => {
    const next = patchSettings(patch)
    if (patch.hotkey) deps.onShortcutChanged()
    broadcast(EVENTS.settingsChanged, next)
    deps.onBackupState()
    return next
  })

  ipcMain.handle(IPC.shortcutProbe, (_event, accelerator: string) => probeShortcut(accelerator))

  ipcMain.handle(IPC.shortcutSet, (_event, accelerator: string) => {
    const result = setShortcut(accelerator)
    return result
  })

  ipcMain.handle(IPC.backupNow, () => backup.runNow())

  ipcMain.handle(IPC.backupState, () => backup.getState())

  ipcMain.handle(IPC.backupRestorePoints, () => backup.listRestorePoints())

  ipcMain.handle(IPC.backupRestore, (_event, key: string) => backup.restore(key))

  ipcMain.handle(IPC.windowAction, (_event, action: 'minimize' | 'maximize' | 'close') => {
    const window = getMainWindow()
    if (!window) return
    if (action === 'minimize') window.minimize()
    else if (action === 'maximize') {
      if (window.isMaximized()) window.unmaximize()
      else window.maximize()
    } else window.hide()
  })

  ipcMain.handle(IPC.appInfo, () => ({
    version: app.getVersion(),
    dataDir: app.getPath('userData'),
    hotkey: getSettings().hotkey
  }))

  ipcMain.handle(IPC.openExternal, async (_event, url: string) => {
    if (/^https?:\/\//i.test(url)) await shell.openExternal(url)
  })

  ipcMain.handle(IPC.captureSubmit, (_event, input: CaptureSubmitInput) => {
    const placement = store.nextPlacement()
    const note = store.createNote({
      kind: input.kind,
      text: input.text ?? '',
      imageId: input.imageId ?? null,
      imageW: input.imageW ?? null,
      imageH: input.imageH ?? null,
      tags: input.tags ?? [],
      color: input.color ?? 'none',
      x: placement.x,
      y: placement.y
    })
    broadcast(EVENTS.flyToRecent, { id: note.id })
    return note
  })

  ipcMain.handle(IPC.captureClose, () => {
    hideCaptureWindow()
  })

  ipcMain.handle(IPC.captureLocate, (_event, noteId: string) => {
    hideCaptureWindow()
    showMainWindow()
    const main = getMainWindow()
    main?.webContents.send(EVENTS.locateNote, { id: noteId })
  })

  // 捕捉窗口内容变化后自适应高度
  ipcMain.handle('capture:resize', (_event, height: number) => {
    const window = getCaptureWindow()
    if (!window) return
    const bounds = window.getBounds()
    const clamped = Math.max(150, Math.min(620, Math.round(height)))
    if (bounds.height !== clamped) window.setBounds({ ...bounds, height: clamped })
  })
}

export function disposeIpc(): void {
  for (const channel of Object.values(IPC)) ipcMain.removeHandler(channel)
  ipcMain.removeHandler('capture:resize')
}

/** 供 index.ts 注册自定义协议时复用 */
export function resolveJotResource(kind: string, id: string): { body: Uint8Array; mime: string } | null {
  if (!isValidImageId(id)) return null
  const bytes = kind === 'orig' ? readOriginal(id) : readThumb(id)
  if (!bytes) return null
  return { body: new Uint8Array(bytes.body), mime: bytes.mime }
}
