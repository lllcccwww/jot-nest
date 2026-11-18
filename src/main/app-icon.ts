import { app, nativeImage, type NativeImage } from 'electron'
import { existsSync } from 'node:fs'
import { join } from 'node:path'

/** 应用图标：开发期读 resources/，打包后由 extraResources 放到 resources 根目录 */
const ICON_FILE = 'app-icon.png'

export function appIconPath(): string | undefined {
  const candidates = [
    join(__dirname, '../../resources', ICON_FILE),
    join(process.resourcesPath ?? '', ICON_FILE),
    join(app.getAppPath(), 'resources', ICON_FILE)
  ]
  return candidates.find((candidate) => existsSync(candidate))
}

export function appIconImage(size?: number): NativeImage | undefined {
  const iconPath = appIconPath()
  if (!iconPath) return undefined
  const image = nativeImage.createFromPath(iconPath)
  if (image.isEmpty()) return undefined
  return size ? image.resize({ width: size, height: size, quality: 'best' }) : image
}
