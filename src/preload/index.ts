import { contextBridge, ipcRenderer } from 'electron'
import { IPC } from '@shared/ipc'
import type { EventChannel } from '@shared/ipc'
import type { JotApi } from '@shared/api'

const invoke = <T>(channel: string, ...args: unknown[]): Promise<T> =>
  ipcRenderer.invoke(channel, ...args) as Promise<T>

const api: JotApi = {
  board: {
    get: () => invoke(IPC.boardGet),
    createNote: (input) => invoke(IPC.noteCreate, input),
    updateNote: (id, patch) => invoke(IPC.noteUpdate, id, patch),
    moveNotes: (items) => invoke(IPC.notesMove, items),
    deleteNotes: (ids) => invoke(IPC.notesDelete, ids),
    createGroup: (input) => invoke(IPC.groupCreate, input),
    updateGroup: (id, patch) => invoke(IPC.groupUpdate, id, patch),
    deleteGroup: (id, keepChildren) => invoke(IPC.groupDelete, id, keepChildren),
    moveGroup: (id, dx, dy) => invoke(IPC.groupMove, id, dx, dy),
    setCamera: (camera, viewport) => invoke(IPC.cameraSet, camera, viewport),
    search: (query) => invoke(IPC.search, query),
    tags: () => invoke(IPC.tagsList)
  },
  images: {
    save: (input) => invoke(IPC.imageSave, input),
    fromClipboard: () => invoke(IPC.clipboardImage)
  },
  settings: {
    get: () => invoke(IPC.settingsGet),
    patch: (patch) => invoke(IPC.settingsPatch, patch),
    probeShortcut: (accelerator) => invoke(IPC.shortcutProbe, accelerator),
    setShortcut: (accelerator) => invoke(IPC.shortcutSet, accelerator)
  },
  backup: {
    state: () => invoke(IPC.backupState),
    now: () => invoke(IPC.backupNow),
    restorePoints: () => invoke(IPC.backupRestorePoints),
    restore: (key) => invoke(IPC.backupRestore, key)
  },
  window: {
    action: (action) => invoke(IPC.windowAction, action)
  },
  app: {
    info: () => invoke(IPC.appInfo),
    openExternal: (url) => invoke(IPC.openExternal, url)
  },
  capture: {
    submit: (input) => invoke(IPC.captureSubmit, input),
    close: () => {
      void ipcRenderer.invoke(IPC.captureClose)
    },
    locate: (noteId) => {
      void ipcRenderer.invoke(IPC.captureLocate, noteId)
    }
  },
  on: (channel: EventChannel, listener: (payload: unknown) => void) => {
    const handler = (_event: Electron.IpcRendererEvent, payload: unknown): void => listener(payload)
    ipcRenderer.on(channel, handler)
    return () => ipcRenderer.removeListener(channel, handler)
  }
}

/** 捕捉窗口用来上报内容高度，主进程据此调整窗口大小 */
const resize = (height: number): void => {
  void ipcRenderer.invoke('capture:resize', height)
}

contextBridge.exposeInMainWorld('jot', api)
contextBridge.exposeInMainWorld('jotInternal', { resize })
