import { randomUUID } from 'node:crypto'
import type { DatabaseSync } from 'node:sqlite'
import { getDb } from './db'
import type {
  BoardSnapshot,
  Camera,
  CardColor,
  CardWidth,
  CreateGroupInput,
  CreateNoteInput,
  GroupPatch,
  Note,
  NoteGroup,
  NoteMove,
  NotePatch,
  SearchQuery,
  TagCount
} from '@shared/types'
import { DEFAULT_CAMERA } from '@shared/types'

interface NoteRow {
  id: string
  kind: string
  text: string
  image_id: string | null
  image_w: number | null
  image_h: number | null
  color: string
  tags: string
  pinned: number
  x: number
  y: number
  w: number
  z: number
  group_id: string | null
  created_at: number
  updated_at: number
  rev: number
}

interface GroupRow {
  id: string
  title: string
  color: string
  x: number
  y: number
  w: number
  h: number
  collapsed: number
  z: number
  created_at: number
  updated_at: number
}

const CARD_WIDTHS: CardWidth[] = [240, 320, 480]
const CARD_COLORS: CardColor[] = ['none', 'sand', 'rose', 'sky', 'sage', 'lilac', 'slate']

function normalizeWidth(value: unknown): CardWidth {
  const n = Number(value)
  return CARD_WIDTHS.includes(n as CardWidth) ? (n as CardWidth) : 320
}

function normalizeColor(value: unknown): CardColor {
  return CARD_COLORS.includes(value as CardColor) ? (value as CardColor) : 'none'
}

function parseTags(raw: string | null): string[] {
  if (!raw) return []
  try {
    const parsed: unknown = JSON.parse(raw)
    if (!Array.isArray(parsed)) return []
    return parsed.filter((t): t is string => typeof t === 'string' && t.length > 0)
  } catch {
    return []
  }
}

function toNote(row: NoteRow): Note {
  return {
    id: row.id,
    kind: row.kind === 'image' ? 'image' : 'text',
    text: row.text ?? '',
    imageId: row.image_id,
    imageW: row.image_w,
    imageH: row.image_h,
    color: normalizeColor(row.color),
    tags: parseTags(row.tags),
    pinned: row.pinned === 1,
    x: row.x,
    y: row.y,
    width: normalizeWidth(row.w),
    z: row.z,
    groupId: row.group_id,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    rev: row.rev
  }
}

function toGroup(row: GroupRow): NoteGroup {
  return {
    id: row.id,
    title: row.title,
    color: normalizeColor(row.color),
    x: row.x,
    y: row.y,
    w: row.w,
    h: row.h,
    collapsed: row.collapsed === 1,
    z: row.z,
    createdAt: row.created_at,
    updatedAt: row.updated_at
  }
}

/**
 * 画布数据仓：SQLite 负责持久化，内存 Map 负责热路径读取与检索。
 * 中文子串检索用内存 includes，避免 FTS5 对连续汉字分词的坑。
 */
export class BoardStore {
  private notes = new Map<string, Note>()
  private groups = new Map<string, NoteGroup>()
  private camera: Camera = { ...DEFAULT_CAMERA }
  private viewport = { w: 1280, h: 800 }
  private listeners = new Set<() => void>()
  private placeSeq = 0

  constructor() {
    this.reload()
  }

  private get db(): DatabaseSync {
    return getDb()
  }

  reload(): void {
    const noteRows = this.db.prepare('SELECT * FROM notes WHERE deleted_at IS NULL').all() as unknown as NoteRow[]
    this.notes = new Map(noteRows.map((row) => [row.id, toNote(row)]))
    const groupRows = this.db
      .prepare('SELECT * FROM groups WHERE deleted_at IS NULL')
      .all() as unknown as GroupRow[]
    this.groups = new Map(groupRows.map((row) => [row.id, toGroup(row)]))
    this.camera = this.readCamera()
    this.placeSeq = Number(this.getMeta('placeSeq') ?? '0') || 0
  }

  onChange(listener: () => void): () => void {
    this.listeners.add(listener)
    return () => this.listeners.delete(listener)
  }

  private emit(): void {
    for (const listener of this.listeners) listener()
  }

  private getMeta(key: string): string | null {
    const row = this.db.prepare('SELECT value FROM meta WHERE key = ?').get(key) as
      | { value: string }
      | undefined
    return row?.value ?? null
  }

  private setMeta(key: string, value: string): void {
    this.db
      .prepare('INSERT INTO meta (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value')
      .run(key, value)
  }

  private readCamera(): Camera {
    const raw = this.getMeta('camera')
    if (!raw) return { ...DEFAULT_CAMERA }
    try {
      const parsed = JSON.parse(raw) as Partial<Camera> & { w?: number; h?: number }
      if (typeof parsed.w === 'number' && typeof parsed.h === 'number') {
        this.viewport = { w: parsed.w, h: parsed.h }
      }
      return {
        x: Number(parsed.x) || 0,
        y: Number(parsed.y) || 0,
        zoom: Number(parsed.zoom) || 1
      }
    } catch {
      return { ...DEFAULT_CAMERA }
    }
  }

  snapshot(): BoardSnapshot {
    return {
      notes: [...this.notes.values()],
      groups: [...this.groups.values()],
      camera: { ...this.camera }
    }
  }

  tags(): TagCount[] {
    const counts = new Map<string, number>()
    for (const note of this.notes.values()) {
      for (const tag of note.tags) counts.set(tag, (counts.get(tag) ?? 0) + 1)
    }
    return [...counts.entries()]
      .map(([tag, count]) => ({ tag, count }))
      .sort((a, b) => b.count - a.count || a.tag.localeCompare(b.tag))
  }

  setCamera(camera: Camera, viewport?: { w: number; h: number }): void {
    this.camera = { x: camera.x, y: camera.y, zoom: camera.zoom }
    if (viewport) this.viewport = viewport
    this.setMeta(
      'camera',
      JSON.stringify({ ...this.camera, w: this.viewport.w, h: this.viewport.h })
    )
  }

  /** 视口中心 + 黄金角放射，避免连续捕捉时卡片完全重叠 */
  nextPlacement(): { x: number; y: number } {
    const centerX = this.camera.x + this.viewport.w / 2 / this.camera.zoom
    const centerY = this.camera.y + this.viewport.h / 2 / this.camera.zoom
    const n = this.placeSeq++
    this.setMeta('placeSeq', String(this.placeSeq))
    const angle = n * 2.399963
    const radius = 46 * Math.sqrt((n % 10) + 1) - 46
    return {
      x: Math.round(centerX + Math.cos(angle) * radius),
      y: Math.round(centerY + Math.sin(angle) * radius)
    }
  }

  createNote(input: CreateNoteInput): Note {
    const now = Date.now()
    const width = normalizeWidth(input.width)
    const note: Note = {
      id: randomUUID(),
      kind: input.kind,
      text: input.text ?? '',
      imageId: input.imageId ?? null,
      imageW: input.imageW ?? null,
      imageH: input.imageH ?? null,
      color: normalizeColor(input.color),
      tags: (input.tags ?? []).filter(Boolean),
      pinned: false,
      x: input.x,
      y: input.y,
      width,
      z: now,
      groupId: input.groupId ?? null,
      createdAt: now,
      updatedAt: now,
      rev: 1
    }
    this.db
      .prepare(
        `INSERT INTO notes (id, kind, text, image_id, image_w, image_h, color, tags, pinned, x, y, w, z, group_id, created_at, updated_at, rev)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
      )
      .run(
        note.id,
        note.kind,
        note.text,
        note.imageId,
        note.imageW,
        note.imageH,
        note.color,
        JSON.stringify(note.tags),
        note.pinned ? 1 : 0,
        note.x,
        note.y,
        note.width,
        note.z,
        note.groupId,
        note.createdAt,
        note.updatedAt,
        note.rev
      )
    this.notes.set(note.id, note)
    this.emit()
    return note
  }

  updateNote(id: string, patch: NotePatch): Note | null {
    const current = this.notes.get(id)
    if (!current) return null
    const next: Note = {
      ...current,
      ...patch,
      tags: patch.tags ? patch.tags.filter(Boolean) : current.tags,
      width: patch.width ? normalizeWidth(patch.width) : current.width,
      color: patch.color ? normalizeColor(patch.color) : current.color,
      updatedAt: Date.now(),
      rev: current.rev + 1
    }
    this.db
      .prepare(
        `UPDATE notes SET text = ?, image_id = ?, image_w = ?, image_h = ?, color = ?, tags = ?, pinned = ?,
         x = ?, y = ?, w = ?, z = ?, group_id = ?, updated_at = ?, rev = ? WHERE id = ?`
      )
      .run(
        next.text,
        next.imageId,
        next.imageW,
        next.imageH,
        next.color,
        JSON.stringify(next.tags),
        next.pinned ? 1 : 0,
        next.x,
        next.y,
        next.width,
        next.z,
        next.groupId,
        next.updatedAt,
        next.rev,
        id
      )
    this.notes.set(id, next)
    this.emit()
    return next
  }

  moveNotes(items: NoteMove[]): void {
    if (items.length === 0) return
    const statement = this.db.prepare('UPDATE notes SET x = ?, y = ?, z = COALESCE(?, z) WHERE id = ?')
    this.db.exec('BEGIN')
    try {
      for (const item of items) {
        const note = this.notes.get(item.id)
        if (!note) continue
        statement.run(item.x, item.y, item.z ?? null, item.id)
        this.notes.set(item.id, { ...note, x: item.x, y: item.y, z: item.z ?? note.z })
      }
      this.db.exec('COMMIT')
    } catch (error) {
      this.db.exec('ROLLBACK')
      throw error
    }
    this.emit()
  }

  deleteNotes(ids: string[]): void {
    if (ids.length === 0) return
    const now = Date.now()
    const statement = this.db.prepare('UPDATE notes SET deleted_at = ? WHERE id = ?')
    for (const id of ids) {
      statement.run(now, id)
      this.notes.delete(id)
    }
    this.emit()
  }

  createGroup(input: CreateGroupInput): NoteGroup {
    const now = Date.now()
    const group: NoteGroup = {
      id: randomUUID(),
      title: input.title,
      color: normalizeColor(input.color),
      x: input.x,
      y: input.y,
      w: input.w,
      h: input.h,
      collapsed: false,
      z: now,
      createdAt: now,
      updatedAt: now
    }
    this.db
      .prepare(
        `INSERT INTO groups (id, title, color, x, y, w, h, collapsed, z, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
      )
      .run(group.id, group.title, group.color, group.x, group.y, group.w, group.h, 0, group.z, now, now)
    this.groups.set(group.id, group)
    const bind = this.db.prepare('UPDATE notes SET group_id = ?, updated_at = ? WHERE id = ?')
    for (const id of input.memberIds) {
      const note = this.notes.get(id)
      if (!note) continue
      bind.run(group.id, now, id)
      this.notes.set(id, { ...note, groupId: group.id, updatedAt: now })
    }
    this.emit()
    return group
  }

  updateGroup(id: string, patch: GroupPatch): NoteGroup | null {
    const current = this.groups.get(id)
    if (!current) return null
    const next: NoteGroup = {
      ...current,
      ...patch,
      color: patch.color ? normalizeColor(patch.color) : current.color,
      updatedAt: Date.now()
    }
    this.db
      .prepare('UPDATE groups SET title = ?, color = ?, x = ?, y = ?, w = ?, h = ?, collapsed = ?, updated_at = ? WHERE id = ?')
      .run(
        next.title,
        next.color,
        next.x,
        next.y,
        next.w,
        next.h,
        next.collapsed ? 1 : 0,
        next.updatedAt,
        id
      )
    this.groups.set(id, next)
    this.emit()
    return next
  }

  /** 整体平移分组及其成员 */
  moveGroup(id: string, dx: number, dy: number): void {
    const group = this.groups.get(id)
    if (!group) return
    const members = [...this.notes.values()].filter((note) => note.groupId === id)
    this.db.exec('BEGIN')
    try {
      this.db.prepare('UPDATE groups SET x = ?, y = ? WHERE id = ?').run(group.x + dx, group.y + dy, id)
      const bind = this.db.prepare('UPDATE notes SET x = ?, y = ? WHERE id = ?')
      for (const note of members) bind.run(note.x + dx, note.y + dy, note.id)
      this.db.exec('COMMIT')
    } catch (error) {
      this.db.exec('ROLLBACK')
      throw error
    }
    this.groups.set(id, { ...group, x: group.x + dx, y: group.y + dy })
    for (const note of members) {
      this.notes.set(note.id, { ...note, x: note.x + dx, y: note.y + dy })
    }
    this.emit()
  }

  deleteGroup(id: string, keepChildren: boolean): void {
    const now = Date.now()
    this.db.exec('BEGIN')
    try {
      this.db.prepare('UPDATE groups SET deleted_at = ? WHERE id = ?').run(now, id)
      if (!keepChildren) this.db.prepare('UPDATE notes SET deleted_at = ? WHERE group_id = ?').run(now, id)
      const bind = this.db.prepare('UPDATE notes SET group_id = NULL WHERE group_id = ?')
      bind.run(id)
      this.db.exec('COMMIT')
    } catch (error) {
      this.db.exec('ROLLBACK')
      throw error
    }
    this.groups.delete(id)
    for (const note of [...this.notes.values()]) {
      if (note.groupId !== id) continue
      if (keepChildren) this.notes.set(note.id, { ...note, groupId: null })
      else this.notes.delete(note.id)
    }
    this.emit()
  }

  search(query: SearchQuery): Note[] {
    const text = (query.text ?? '').trim().toLowerCase()
    const tags = query.tags ?? []
    const results: Note[] = []
    for (const note of this.notes.values()) {
      if (query.pinnedOnly && !note.pinned) continue
      if (query.from && note.createdAt < query.from) continue
      if (query.to && note.createdAt > query.to) continue
      if (tags.length > 0 && !tags.every((tag) => note.tags.includes(tag))) continue
      if (text) {
        const haystack = `${note.text}\n${note.tags.join(' ')}`.toLowerCase()
        if (!haystack.includes(text)) continue
      }
      results.push(note)
    }
    return results.sort((a, b) => {
      if (text) {
        const aIndex = a.text.toLowerCase().indexOf(text)
        const bIndex = b.text.toLowerCase().indexOf(text)
        if (aIndex !== bIndex) return aIndex - bIndex
      }
      if (a.pinned !== b.pinned) return a.pinned ? -1 : 1
      return b.updatedAt - a.updatedAt
    })
  }

  recent(limit = 1): Note[] {
    return [...this.notes.values()].sort((a, b) => b.createdAt - a.createdAt).slice(0, limit)
  }

  noteCount(): number {
    return this.notes.size
  }

  vacuumInto(target: string): void {
    const escaped = target.replace(/'/g, "''")
    this.db.exec(`VACUUM INTO '${escaped}'`)
  }
}
