/**
 * 生成应用图标与托盘图标（无第三方依赖，纯手工光栅 + PNG/ICO 编码）。
 * 用法：node tools/make-icon.mjs
 */
import { deflateSync } from 'node:zlib'
import { mkdirSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')
const SS = 4 // 超采样倍数

const INK_TOP = [86, 132, 240]
const INK_BOTTOM = [43, 88, 196]
const CARD = [255, 255, 255]
const LINE = [43, 88, 196]
const ACCENT = [255, 205, 122]

function createCanvas(size) {
  return { size, data: new Uint8ClampedArray(size * size * 4) }
}

function blend(canvas, x, y, [r, g, b], alpha) {
  if (x < 0 || y < 0 || x >= canvas.size || y >= canvas.size) return
  const index = (y * canvas.size + x) * 4
  const dst = canvas.data
  const a = alpha
  dst[index] = dst[index] * (1 - a) + r * a
  dst[index + 1] = dst[index + 1] * (1 - a) + g * a
  dst[index + 2] = dst[index + 2] * (1 - a) + b * a
  dst[index + 3] = Math.max(dst[index + 3], Math.round(255 * a))
}

function roundRect(canvas, x, y, w, h, radius, color, alpha = 1) {
  const r = Math.min(radius, w / 2, h / 2)
  for (let py = Math.floor(y); py < Math.ceil(y + h); py += 1) {
    for (let px = Math.floor(x); px < Math.ceil(x + w); px += 1) {
      const cx = Math.min(Math.max(px + 0.5, x + r), x + w - r)
      const cy = Math.min(Math.max(py + 0.5, y + r), y + h - r)
      const distance = Math.hypot(px + 0.5 - cx, py + 0.5 - cy)
      const edge = r - distance
      if (edge <= 0) continue
      blend(canvas, px, py, color, alpha * Math.min(1, edge))
    }
  }
}

function gradientRoundRect(canvas, x, y, w, h, radius, from, to) {
  const r = Math.min(radius, w / 2, h / 2)
  for (let py = Math.floor(y); py < Math.ceil(y + h); py += 1) {
    const t = (py - y) / h
    const color = [
      Math.round(from[0] + (to[0] - from[0]) * t),
      Math.round(from[1] + (to[1] - from[1]) * t),
      Math.round(from[2] + (to[2] - from[2]) * t)
    ]
    for (let px = Math.floor(x); px < Math.ceil(x + w); px += 1) {
      const cx = Math.min(Math.max(px + 0.5, x + r), x + w - r)
      const cy = Math.min(Math.max(py + 0.5, y + r), y + h - r)
      const distance = Math.hypot(px + 0.5 - cx, py + 0.5 - cy)
      const edge = r - distance
      if (edge <= 0) continue
      blend(canvas, px, py, color, Math.min(1, edge))
    }
  }
}

function downsample(canvas, target) {
  const out = createCanvas(target)
  const factor = canvas.size / target
  for (let y = 0; y < target; y += 1) {
    for (let x = 0; x < target; x += 1) {
      let r = 0
      let g = 0
      let b = 0
      let a = 0
      let count = 0
      for (let sy = 0; sy < factor; sy += 1) {
        for (let sx = 0; sx < factor; sx += 1) {
          const index = ((y * factor + sy) * canvas.size + (x * factor + sx)) * 4
          const alpha = canvas.data[index + 3] / 255
          r += canvas.data[index] * alpha
          g += canvas.data[index + 1] * alpha
          b += canvas.data[index + 2] * alpha
          a += alpha
          count += 1
        }
      }
      const index = (y * target + x) * 4
      if (a > 0) {
        out.data[index] = Math.round(r / a)
        out.data[index + 1] = Math.round(g / a)
        out.data[index + 2] = Math.round(b / a)
      }
      out.data[index + 3] = Math.round((a / count) * 255)
    }
  }
  return out
}

function crc32(buffer) {
  let table = crc32.table
  if (!table) {
    table = crc32.table = new Int32Array(256)
    for (let n = 0; n < 256; n += 1) {
      let c = n
      for (let k = 0; k < 8; k += 1) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1
      table[n] = c
    }
  }
  let crc = -1
  for (const byte of buffer) crc = table[(crc ^ byte) & 0xff] ^ (crc >>> 8)
  return (crc ^ -1) >>> 0
}

function chunk(type, payload) {
  const length = Buffer.alloc(4)
  length.writeUInt32BE(payload.length, 0)
  const body = Buffer.concat([Buffer.from(type, 'ascii'), payload])
  const crc = Buffer.alloc(4)
  crc.writeUInt32BE(crc32(body), 0)
  return Buffer.concat([length, body, crc])
}

function encodePng(canvas) {
  const { size, data } = canvas
  const raw = Buffer.alloc(size * (size * 4 + 1))
  for (let y = 0; y < size; y += 1) {
    raw[y * (size * 4 + 1)] = 0
    for (let x = 0; x < size * 4; x += 1) {
      raw[y * (size * 4 + 1) + 1 + x] = data[y * size * 4 + x]
    }
  }
  const ihdr = Buffer.alloc(13)
  ihdr.writeUInt32BE(size, 0)
  ihdr.writeUInt32BE(size, 4)
  ihdr[8] = 8
  ihdr[9] = 6
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    chunk('IDAT', deflateSync(raw, { level: 9 })),
    chunk('IEND', Buffer.alloc(0))
  ])
}

function encodeIco(pngBuffers) {
  const header = Buffer.alloc(6)
  header.writeUInt16LE(0, 0)
  header.writeUInt16LE(1, 2)
  header.writeUInt16LE(pngBuffers.length, 4)
  let offset = 6 + pngBuffers.length * 16
  const entries = []
  for (const { size, buffer } of pngBuffers) {
    const entry = Buffer.alloc(16)
    entry[0] = size >= 256 ? 0 : size
    entry[1] = size >= 256 ? 0 : size
    entry[2] = 0
    entry[3] = 0
    entry.writeUInt16LE(1, 4)
    entry.writeUInt16LE(32, 6)
    entry.writeUInt32LE(buffer.length, 8)
    entry.writeUInt32LE(offset, 12)
    offset += buffer.length
    entries.push(entry)
  }
  return Buffer.concat([header, ...entries, ...pngBuffers.map((item) => item.buffer)])
}

/** 图标主体：圆角墨蓝底 + 白色便签卡 + 三条纹理线 + 强调色圆点 */
function drawMark(size, opts = {}) {
  const { simple = false } = opts
  const canvas = createCanvas(size * SS)
  const s = size * SS
  const pad = s * 0.055
  gradientRoundRect(canvas, pad, pad, s - pad * 2, s - pad * 2, s * 0.235, INK_TOP, INK_BOTTOM)

  const cardW = s * (simple ? 0.44 : 0.5)
  const cardH = s * (simple ? 0.5 : 0.56)
  const cardX = (s - cardW) / 2
  const cardY = (s - cardH) / 2
  roundRect(canvas, cardX, cardY, cardW, cardH, s * 0.075, CARD, 0.97)

  if (!simple) {
    const lineHeight = s * 0.032
    const lineRadius = lineHeight / 2
    const inset = s * 0.062
    for (let index = 0; index < 3; index += 1) {
      const width = cardW - inset * 2 - (index === 2 ? cardW * 0.26 : 0)
      roundRect(
        canvas,
        cardX + inset,
        cardY + inset + index * (lineHeight + s * 0.045),
        width,
        lineHeight,
        lineRadius,
        LINE,
        0.75
      )
    }
    const dotSize = s * 0.085
    roundRect(
      canvas,
      cardX + cardW - inset - dotSize,
      cardY + cardH - inset - dotSize,
      dotSize,
      dotSize,
      dotSize / 2,
      ACCENT,
      1
    )
  }

  return downsample(canvas, size)
}

mkdirSync(join(ROOT, 'build'), { recursive: true })
mkdirSync(join(ROOT, 'resources'), { recursive: true })

const sizes = [16, 24, 32, 48, 64, 128, 256]
const pngs = sizes.map((size) => ({ size, buffer: encodePng(drawMark(size, { simple: size <= 24 })) }))

writeFileSync(join(ROOT, 'build/icon.png'), encodePng(drawMark(512)))
writeFileSync(join(ROOT, 'build/icon.ico'), encodeIco(pngs.filter((item) => item.size >= 16)))
writeFileSync(join(ROOT, 'resources/tray.png'), encodePng(drawMark(32, { simple: true })))
console.log('icons written')
