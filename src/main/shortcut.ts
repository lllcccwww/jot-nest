import { globalShortcut } from 'electron'
import { getSettings, patchSettings } from './store/settings'
import { openCaptureWindow } from './windows'
import type { ShortcutProbeResult } from '@shared/types'

let currentAccelerator: string | null = null

function tryRegister(accelerator: string): ShortcutProbeResult {
  try {
    const ok = globalShortcut.register(accelerator, () => {
      openCaptureWindow()
    })
    return ok ? { ok: true } : { ok: false, conflictWith: '其他程序' }
  } catch (error) {
    return { ok: false, conflictWith: error instanceof Error ? error.message : '无效的快捷键' }
  }
}

export function registerCaptureShortcut(accelerator: string): ShortcutProbeResult {
  if (currentAccelerator) {
    globalShortcut.unregister(currentAccelerator)
    currentAccelerator = null
  }
  const result = tryRegister(accelerator)
  if (result.ok) currentAccelerator = accelerator
  return result
}

/** 探测某个快捷键是否可用：临时注册后立刻释放，并恢复原快捷键 */
export function probeShortcut(accelerator: string): ShortcutProbeResult {
  const previous = currentAccelerator
  if (previous) {
    globalShortcut.unregister(previous)
    currentAccelerator = null
  }
  const result = tryRegister(accelerator)
  if (result.ok) globalShortcut.unregister(accelerator)
  if (previous) {
    const restored = tryRegister(previous)
    if (restored.ok) currentAccelerator = previous
  }
  return result
}

export function setShortcut(accelerator: string): ShortcutProbeResult {
  const result = registerCaptureShortcut(accelerator)
  if (result.ok) patchSettings({ hotkey: accelerator })
  return result
}

export function initShortcut(): ShortcutProbeResult {
  const { hotkey } = getSettings()
  const result = registerCaptureShortcut(hotkey)
  if (!result.ok) {
    // 用户已配置的快捷键被占用时，不要静默失败：主窗口会读设置展示提示
    console.warn(`[jot] 全局快捷键 ${hotkey} 注册失败`)
  }
  return result
}

export function disposeShortcuts(): void {
  globalShortcut.unregisterAll()
  currentAccelerator = null
}
