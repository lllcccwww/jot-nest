/**
 * 跨进程共享的数据模型与契约类型。
 * 主进程、preload、渲染进程都从这里取类型，禁止各自重复定义。
 */

export type NoteKind = 'text' | 'image'

/** 卡片三档宽度 */
export type CardWidth = 240 | 320 | 480

export const CARD_WIDTHS: CardWidth[] = [240, 320, 480]

export type CardColor = 'none' | 'sand' | 'rose' | 'sky' | 'sage' | 'lilac' | 'slate'

export const CARD_COLORS: CardColor[] = ['none', 'sand', 'rose', 'sky', 'sage', 'lilac', 'slate']

export interface Note {
  id: string
  kind: NoteKind
  text: string
  imageId: string | null
  imageW: number | null
  imageH: number | null
  color: CardColor
  tags: string[]
  pinned: boolean
  x: number
  y: number
  width: CardWidth
  z: number
  groupId: string | null
  createdAt: number
  updatedAt: number
  rev: number
}

export interface NoteGroup {
  id: string
  title: string
  color: CardColor
  x: number
  y: number
  w: number
  h: number
  collapsed: boolean
  z: number
  createdAt: number
  updatedAt: number
}

export interface Camera {
  x: number
  y: number
  zoom: number
}

export const DEFAULT_CAMERA: Camera = { x: 0, y: 0, zoom: 1 }

export interface BoardSnapshot {
  notes: Note[]
  groups: NoteGroup[]
  camera: Camera
}

export interface CreateNoteInput {
  kind: NoteKind
  text?: string
  imageId?: string | null
  imageW?: number | null
  imageH?: number | null
  tags?: string[]
  color?: CardColor
  width?: CardWidth
  x: number
  y: number
  groupId?: string | null
}

export type NotePatch = Partial<
  Pick<
    Note,
    'text' | 'tags' | 'color' | 'pinned' | 'width' | 'x' | 'y' | 'z' | 'groupId' | 'imageId' | 'imageW' | 'imageH'
  >
>

export interface NoteMove {
  id: string
  x: number
  y: number
  z?: number
}

export interface GroupPatch {
  title?: string
  color?: CardColor
  x?: number
  y?: number
  w?: number
  h?: number
  collapsed?: boolean
  z?: number
}

export interface CreateGroupInput {
  title: string
  color?: CardColor
  x: number
  y: number
  w: number
  h: number
  memberIds: string[]
}

export interface SearchQuery {
  text?: string
  tags?: string[]
  pinnedOnly?: boolean
  /** 时间范围，按 created_at 过滤 */
  from?: number
  to?: number
}

export interface ImageSaveInput {
  /** 原图 data URL（可能已在渲染进程降采样） */
  dataUrl: string
  /** 512px 缩略图 data URL */
  thumbDataUrl: string
  width: number
  height: number
}

export interface ImageSaveResult {
  id: string
  width: number
  height: number
}

export interface TagCount {
  tag: string
  count: number
}

export type ThemeMode = 'light' | 'dark' | 'system'

export interface CosConfig {
  bucket: string
  region: string
  prefix: string
  /** 是否已保存过密钥 */
  hasCredential: boolean
}

/** 渲染进程可读的设置（不含任何明文密钥） */
export interface AppSettings {
  hotkey: string
  theme: ThemeMode
  autoLaunch: boolean
  autoUpdate: boolean
  updateFeedUrl: string
  cos: CosConfig
}

export interface SettingsPatch {
  hotkey?: string
  theme?: ThemeMode
  autoLaunch?: boolean
  autoUpdate?: boolean
  updateFeedUrl?: string
  cos?: {
    bucket?: string
    region?: string
    prefix?: string
    /** 传空字符串表示清除密钥 */
    secretId?: string
    secretKey?: string
  }
}

export type BackupStatus = 'disabled' | 'idle' | 'syncing' | 'ok' | 'error'

export interface BackupState {
  status: BackupStatus
  message?: string
  at?: number
  /** 上次成功同步的图片数量等摘要 */
  uploadedImages?: number
}

export interface ShortcutProbeResult {
  ok: boolean
  conflictWith?: string
}

export interface CaptureSubmitInput {
  kind: NoteKind
  text?: string
  imageId?: string | null
  imageW?: number | null
  imageH?: number | null
  tags?: string[]
  color?: CardColor
}

export interface CaptureResult {
  note: Note
}

export interface RestorePoint {
  key: string
  size: number
  lastModified: string
}

export type WindowAction = 'minimize' | 'maximize' | 'close'

export interface WindowState {
  maximized: boolean
  focused: boolean
}
