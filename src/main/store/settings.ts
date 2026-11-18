import { app, safeStorage } from 'electron'
import { readFileSync, writeFileSync } from 'node:fs'
import { paths } from './db'
import type { AppSettings, SettingsPatch, ThemeMode } from '@shared/types'

export const DEFAULT_HOTKEY = 'Control+Alt+N'

interface StoredCos {
  bucket: string
  region: string
  prefix: string
  /** safeStorage 加密后的 base64 */
  secretId?: string
  secretKey?: string
}

interface StoredSettings {
  hotkey: string
  theme: ThemeMode
  autoLaunch: boolean
  autoUpdate: boolean
  updateFeedUrl: string
  cos: StoredCos
}

const DEFAULTS: StoredSettings = {
  hotkey: DEFAULT_HOTKEY,
  theme: 'system',
  autoLaunch: false,
  autoUpdate: true,
  updateFeedUrl: '',
  cos: { bucket: '', region: 'ap-guangzhou', prefix: 'jot' }
}

let cache: StoredSettings | null = null

function readStored(): StoredSettings {
  if (cache) return cache
  try {
    const raw = JSON.parse(readFileSync(paths().settingsFile, 'utf8')) as Partial<StoredSettings>
    cache = {
      ...DEFAULTS,
      ...raw,
      cos: { ...DEFAULTS.cos, ...(raw.cos ?? {}) }
    }
  } catch {
    cache = { ...DEFAULTS, cos: { ...DEFAULTS.cos } }
  }
  return cache
}

function writeStored(next: StoredSettings): void {
  cache = next
  writeFileSync(paths().settingsFile, JSON.stringify(next, null, 2), 'utf8')
}

function encrypt(value: string): string {
  if (!value) return ''
  if (safeStorage.isEncryptionAvailable()) {
    return safeStorage.encryptString(value).toString('base64')
  }
  // 无法加密时退化为 base64 + 前缀标记，至少不写明文（此路径仅出现在异常环境）
  return `raw:${Buffer.from(value, 'utf8').toString('base64')}`
}

function decrypt(value: string | undefined): string {
  if (!value) return ''
  if (value.startsWith('raw:')) {
    return Buffer.from(value.slice(4), 'base64').toString('utf8')
  }
  try {
    return safeStorage.decryptString(Buffer.from(value, 'base64'))
  } catch {
    return ''
  }
}

export function getSettings(): AppSettings {
  const stored = readStored()
  return {
    hotkey: stored.hotkey,
    theme: stored.theme,
    autoLaunch: stored.autoLaunch,
    autoUpdate: stored.autoUpdate,
    updateFeedUrl: stored.updateFeedUrl,
    cos: {
      bucket: stored.cos.bucket,
      region: stored.cos.region,
      prefix: stored.cos.prefix,
      hasCredential: Boolean(stored.cos.secretId && stored.cos.secretKey)
    }
  }
}

export function getCredentials(): { secretId: string; secretKey: string } | null {
  const stored = readStored()
  const secretId = decrypt(stored.cos.secretId)
  const secretKey = decrypt(stored.cos.secretKey)
  if (!secretId || !secretKey) return null
  return { secretId, secretKey }
}

export function patchSettings(patch: SettingsPatch): AppSettings {
  const stored = readStored()
  const next: StoredSettings = {
    ...stored,
    hotkey: patch.hotkey ?? stored.hotkey,
    theme: patch.theme ?? stored.theme,
    autoLaunch: patch.autoLaunch ?? stored.autoLaunch,
    autoUpdate: patch.autoUpdate ?? stored.autoUpdate,
    updateFeedUrl: patch.updateFeedUrl ?? stored.updateFeedUrl,
    cos: { ...stored.cos }
  }
  if (patch.cos) {
    if (patch.cos.bucket !== undefined) next.cos.bucket = patch.cos.bucket.trim()
    if (patch.cos.region !== undefined) next.cos.region = patch.cos.region.trim()
    if (patch.cos.prefix !== undefined) next.cos.prefix = patch.cos.prefix.trim()
    if (patch.cos.secretId !== undefined) {
      next.cos.secretId = patch.cos.secretId ? encrypt(patch.cos.secretId.trim()) : undefined
    }
    if (patch.cos.secretKey !== undefined) {
      next.cos.secretKey = patch.cos.secretKey ? encrypt(patch.cos.secretKey.trim()) : undefined
    }
  }
  writeStored(next)
  applyAutoLaunch(next.autoLaunch)
  return getSettings()
}

export function applyAutoLaunch(enabled: boolean): void {
  if (!app.isPackaged) return
  try {
    app.setLoginItemSettings({ openAtLogin: enabled, path: app.getPath('exe') })
  } catch {
    /* 忽略：非关键能力 */
  }
}

export function isCosConfigured(): boolean {
  const stored = readStored()
  return Boolean(stored.cos.bucket && stored.cos.region && stored.cos.secretId && stored.cos.secretKey)
}
