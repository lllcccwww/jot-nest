import type { ImageSaveResult } from '@shared/types'

const MAX_EDGE = 4096
const MAX_BYTES = 8 * 1024 * 1024
const THUMB_EDGE = 512

export interface PreparedImage extends ImageSaveResult {
  dataUrl: string
  thumbDataUrl: string
  width: number
  height: number
}

async function loadBitmap(blob: Blob): Promise<ImageBitmap> {
  return createImageBitmap(blob)
}

function drawToCanvas(bitmap: ImageBitmap, scale: number): HTMLCanvasElement {
  const width = Math.max(1, Math.round(bitmap.width * scale))
  const height = Math.max(1, Math.round(bitmap.height * scale))
  const canvas = document.createElement('canvas')
  canvas.width = width
  canvas.height = height
  const context = canvas.getContext('2d')
  if (!context) throw new Error('canvas 2d context unavailable')
  context.imageSmoothingQuality = 'high'
  context.drawImage(bitmap, 0, 0, width, height)
  return canvas
}

function pickMime(blob: Blob): string {
  return blob.type === 'image/png' || blob.type === 'image/gif' ? 'image/png' : 'image/jpeg'
}

/** 原图按上限降采样后编码，同时产出 512px 缩略图。全部在渲染进程完成，主进程只落盘。 */
export async function prepareImage(blob: Blob): Promise<PreparedImage> {
  const bitmap = await loadBitmap(blob)
  const longest = Math.max(bitmap.width, bitmap.height)
  const needsDownscale = longest > MAX_EDGE || blob.size > MAX_BYTES
  const scale = needsDownscale ? Math.min(1, MAX_EDGE / longest) : 1
  const mime = pickMime(blob)

  let dataUrl: string
  let width = bitmap.width
  let height = bitmap.height

  if (scale === 1 && blob.type !== 'image/gif') {
    // 未超限：保留原始字节，避免二次编码损失
    dataUrl = await blobToDataUrl(blob)
  } else {
    const canvas = drawToCanvas(bitmap, scale)
    dataUrl = canvas.toDataURL(mime === 'image/png' ? 'image/png' : 'image/jpeg', 0.94)
    width = canvas.width
    height = canvas.height
  }

  const thumbScale = Math.min(1, THUMB_EDGE / Math.max(bitmap.width, bitmap.height))
  const thumbCanvas = drawToCanvas(bitmap, thumbScale)
  const thumbDataUrl = thumbCanvas.toDataURL('image/webp', 0.82)
  bitmap.close()

  return { id: '', dataUrl, thumbDataUrl, width, height }
}

export function blobToDataUrl(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => resolve(String(reader.result))
    reader.onerror = () => reject(new Error('读取图片失败'))
    reader.readAsDataURL(blob)
  })
}

export function dataUrlToBlob(dataUrl: string): Blob {
  const [head, body] = dataUrl.split(',')
  const mime = /data:([^;]+)/.exec(head)?.[1] ?? 'image/png'
  const binary = atob(body ?? '')
  const bytes = new Uint8Array(binary.length)
  for (let index = 0; index < binary.length; index += 1) bytes[index] = binary.charCodeAt(index)
  return new Blob([bytes], { type: mime })
}

export async function prepareImageFromDataUrl(dataUrl: string): Promise<PreparedImage> {
  return prepareImage(dataUrlToBlob(dataUrl))
}
