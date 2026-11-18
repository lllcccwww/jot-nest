import type {
  AppSettings,
  BackupState,
  BoardSnapshot,
  Camera,
  CaptureSubmitInput,
  CardColor,
  CardWidth,
  CreateGroupInput,
  GroupPatch,
  ImageSaveInput,
  ImageSaveResult,
  Note,
  NoteGroup,
  NoteMove,
  NotePatch,
  RestorePoint,
  SearchQuery,
  SettingsPatch,
  ShortcutProbeResult,
  TagCount,
  WindowAction
} from './types'
import type { EventChannel } from './ipc'

/** preload 通过 contextBridge 暴露给渲染进程的能力集合 */
export interface JotApi {
  board: {
    get(): Promise<BoardSnapshot>
    createNote(input: {
      kind: 'text' | 'image'
      text?: string
      imageId?: string | null
      imageW?: number | null
      imageH?: number | null
      tags?: string[]
      color?: CardColor
      width?: CardWidth
      x: number
      y: number
    }): Promise<Note>
    updateNote(id: string, patch: NotePatch): Promise<Note | null>
    moveNotes(items: NoteMove[]): Promise<void>
    deleteNotes(ids: string[]): Promise<void>
    createGroup(input: CreateGroupInput): Promise<NoteGroup>
    updateGroup(id: string, patch: GroupPatch): Promise<NoteGroup | null>
    deleteGroup(id: string, keepChildren: boolean): Promise<void>
    moveGroup(id: string, dx: number, dy: number): Promise<void>
    setCamera(camera: Camera, viewport: { w: number; h: number }): Promise<void>
    search(query: SearchQuery): Promise<Note[]>
    tags(): Promise<TagCount[]>
  }
  images: {
    save(input: ImageSaveInput): Promise<ImageSaveResult>
    /** 读取系统剪贴板中的图片（PNG data URL），用于粘贴兜底 */
    fromClipboard(): Promise<string | null>
  }
  settings: {
    get(): Promise<AppSettings>
    patch(patch: SettingsPatch): Promise<AppSettings>
    probeShortcut(accelerator: string): Promise<ShortcutProbeResult>
    setShortcut(accelerator: string): Promise<ShortcutProbeResult>
  }
  backup: {
    state(): Promise<BackupState>
    now(): Promise<BackupState>
    restorePoints(): Promise<RestorePoint[]>
    restore(key: string): Promise<{ ok: boolean; message: string }>
  }
  window: {
    action(action: WindowAction): Promise<void>
  }
  app: {
    info(): Promise<{ version: string; dataDir: string; hotkey: string }>
    openExternal(url: string): Promise<void>
  }
  capture: {
    submit(input: CaptureSubmitInput): Promise<Note>
    close(): void
    locate(noteId: string): void
  }
  on(channel: EventChannel, listener: (payload: unknown) => void): () => void
}

declare global {
  interface Window {
    jot: JotApi
    /** 捕捉窗口专用：上报内容高度以便主进程调整窗口大小 */
    jotInternal: { resize(height: number): void }
  }
}
