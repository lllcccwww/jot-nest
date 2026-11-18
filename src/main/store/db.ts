import { app } from 'electron'
import { mkdirSync } from 'node:fs'
import { join } from 'node:path'
import { DatabaseSync } from 'node:sqlite'

export interface AppPaths {
  userData: string
  images: string
  thumbs: string
  dbFile: string
  settingsFile: string
  updatesDir: string
}

let cachedPaths: AppPaths | null = null

export function paths(): AppPaths {
  if (cachedPaths) return cachedPaths
  const userData = app.getPath('userData')
  cachedPaths = {
    userData,
    images: join(userData, 'images'),
    thumbs: join(userData, 'thumbs'),
    dbFile: join(userData, 'jot.db'),
    settingsFile: join(userData, 'settings.json'),
    updatesDir: join(userData, 'updates')
  }
  mkdirSync(cachedPaths.images, { recursive: true })
  mkdirSync(cachedPaths.thumbs, { recursive: true })
  return cachedPaths
}

let db: DatabaseSync | null = null

export function openDatabase(): DatabaseSync {
  if (db) return db
  const p = paths()
  db = new DatabaseSync(p.dbFile)
  db.exec('PRAGMA journal_mode = WAL')
  db.exec('PRAGMA synchronous = NORMAL')
  db.exec('PRAGMA foreign_keys = ON')
  migrate(db)
  return db
}

export function getDb(): DatabaseSync {
  if (!db) throw new Error('database not opened')
  return db
}

export function closeDatabase(): void {
  if (db) {
    try {
      db.close()
    } catch {
      /* ignore */
    }
    db = null
  }
}

function migrate(connection: DatabaseSync): void {
  connection.exec(`
    CREATE TABLE IF NOT EXISTS notes (
      id TEXT PRIMARY KEY,
      kind TEXT NOT NULL,
      text TEXT NOT NULL DEFAULT '',
      image_id TEXT,
      image_w INTEGER,
      image_h INTEGER,
      color TEXT NOT NULL DEFAULT 'none',
      tags TEXT NOT NULL DEFAULT '[]',
      pinned INTEGER NOT NULL DEFAULT 0,
      x REAL NOT NULL,
      y REAL NOT NULL,
      w INTEGER NOT NULL DEFAULT 320,
      z REAL NOT NULL DEFAULT 0,
      group_id TEXT,
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL,
      deleted_at INTEGER,
      rev INTEGER NOT NULL DEFAULT 1
    );

    CREATE TABLE IF NOT EXISTS groups (
      id TEXT PRIMARY KEY,
      title TEXT NOT NULL DEFAULT '',
      color TEXT NOT NULL DEFAULT 'none',
      x REAL NOT NULL,
      y REAL NOT NULL,
      w REAL NOT NULL,
      h REAL NOT NULL,
      collapsed INTEGER NOT NULL DEFAULT 0,
      z REAL NOT NULL DEFAULT 0,
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL,
      deleted_at INTEGER
    );

    CREATE TABLE IF NOT EXISTS meta (
      key TEXT PRIMARY KEY,
      value TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS backup_objects (
      key TEXT PRIMARY KEY,
      size INTEGER NOT NULL DEFAULT 0,
      at INTEGER NOT NULL
    );

    CREATE INDEX IF NOT EXISTS idx_notes_updated ON notes (deleted_at, updated_at DESC);
    CREATE INDEX IF NOT EXISTS idx_notes_group ON notes (group_id);
  `)
}
