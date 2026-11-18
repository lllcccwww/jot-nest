import { createHash } from 'node:crypto'
import { existsSync, readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { getDb, paths } from './db'
import type { ImageSaveInput, ImageSaveResult } from '@shared/types'

const MIME_SIGNATURES: Array<{ mime: string; test: (buffer: Buffer) => boolean }> = [
  { mime: 'image/png', test: (b) => b.length > 8 && b[0] === 0x89 && b[1] === 0x50 && b[2] === 0x4e && b[3] === 0x47 },
  { mime: 'image/jpeg', test: (b) => b.length > 3 && b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff },
  { mime: 'image/gif', test: (b) => b.length > 3 && b.subarray(0, 3).toString('ascii') === 'GIF' },
  {
    mime: 'image/webp',
    test: (b) => b.length > 12 && b.subarray(0, 4).toString('ascii') === 'RIFF' && b.subarray(8, 12).toString('ascii') === 'WEBP'
  },
  { mime: 'image/bmp', test: (b) => b.length > 2 && b.subarray(0, 2).toString('ascii') === 'BM' }
]

function sniffMime(buffer: Buffer): string {
  for (const signature of MIME_SIGNATURES) {
    if (signature.test(buffer)) return signature.mime
  }
  return 'application/octet-stream'
}

function decodeDataUrl(dataUrl: string): Buffer {
  const index = dataUrl.indexOf(',')
  if (index < 0) throw new Error('invalid data url')
  return Buffer.from(dataUrl.slice(index + 1), 'base64')
}

export function saveImage(input: ImageSaveInput): ImageSaveResult {
  const original = decodeDataUrl(input.dataUrl)
  const id = createHash('sha256').update(original).digest('hex')
  const originalPath = join(paths().images, id)
  if (!existsSync(originalPath)) {
    writeFileSync(originalPath, original)
  }
  const thumbPath = join(paths().thumbs, `${id}.webp`)
  if (!existsSync(thumbPath)) {
    const thumb = decodeDataUrl(input.thumbDataUrl)
    writeFileSync(thumbPath, thumb)
  }
  getDb()
    .prepare('INSERT INTO backup_objects (key, size, at) VALUES (?, ?, ?) ON CONFLICT(key) DO NOTHING')
    .run(`images/${id}`, original.length, 0)
  return { id, width: input.width, height: input.height }
}

export interface ImageBytes {
  body: Buffer
  mime: string
}

export function readThumb(id: string): ImageBytes | null {
  const thumbPath = join(paths().thumbs, `${id}.webp`)
  if (existsSync(thumbPath)) return { body: readFileSync(thumbPath), mime: 'image/webp' }
  return readOriginal(id)
}

export function readOriginal(id: string): ImageBytes | null {
  const originalPath = join(paths().images, id)
  if (!existsSync(originalPath)) return null
  const body = readFileSync(originalPath)
  return { body, mime: sniffMime(body) }
}

export function listLocalImages(): Array<{ id: string; size: number }> {
  const dir = paths().images
  if (!existsSync(dir)) return []
  return readdirSync(dir)
    .filter((name) => /^[0-9a-f]{64}$/.test(name))
    .map((name) => ({ id: name, size: statSync(join(dir, name)).size }))
}

/** 校验 sha256 形式的 id，防止协议处理里被路径穿越 */
export function isValidImageId(id: string): boolean {
  return /^[0-9a-f]{64}$/.test(id)
}
