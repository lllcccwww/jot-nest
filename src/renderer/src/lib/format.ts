import type { CardColor } from '@shared/types'

const COLOR_LABELS: Record<CardColor, string> = {
  none: '默认',
  sand: '沙',
  rose: '玫瑰',
  sky: '天青',
  sage: '苔绿',
  lilac: '薰衣草',
  slate: '石墨'
}

export function colorLabel(color: CardColor): string {
  return COLOR_LABELS[color]
}

export function formatAccelerator(accelerator: string): string {
  return accelerator
    .replace(/CommandOrControl|CmdOrCtrl|Control/g, 'Ctrl')
    .replace(/Alt/g, 'Alt')
    .replace(/Shift/g, 'Shift')
    .replace(/Super|Meta/g, 'Win')
}

export function relativeTime(timestamp: number): string {
  const diff = Date.now() - timestamp
  const minute = 60_000
  const hour = 60 * minute
  const day = 24 * hour
  if (diff < minute) return '刚刚'
  if (diff < hour) return `${Math.floor(diff / minute)} 分钟前`
  if (diff < day) return `${Math.floor(diff / hour)} 小时前`
  if (diff < 7 * day) return `${Math.floor(diff / day)} 天前`
  const date = new Date(timestamp)
  const sameYear = date.getFullYear() === new Date().getFullYear()
  return sameYear
    ? `${date.getMonth() + 1}月${date.getDate()}日`
    : `${date.getFullYear()}/${date.getMonth() + 1}/${date.getDate()}`
}

export function isFresh(timestamp: number): boolean {
  return Date.now() - timestamp < 24 * 60 * 60 * 1000
}

/** 把键盘事件翻译成 Electron accelerator，无法识别时返回 null */
export function acceleratorFromEvent(event: KeyboardEvent): string | null {
  const key = event.key
  if (['Control', 'Shift', 'Alt', 'Meta', 'CapsLock', 'Tab', 'Escape'].includes(key)) return null
  const parts: string[] = []
  if (event.ctrlKey) parts.push('Control')
  if (event.shiftKey) parts.push('Shift')
  if (event.altKey) parts.push('Alt')
  if (event.metaKey) parts.push('Super')
  if (parts.length === 0) return null

  const named: Record<string, string> = {
    ' ': 'Space',
    ArrowUp: 'Up',
    ArrowDown: 'Down',
    ArrowLeft: 'Left',
    ArrowRight: 'Right',
    Enter: 'Return',
    Escape: 'Escape',
    Backspace: 'Backspace',
    Delete: 'Delete',
    Tab: 'Tab'
  }
  const normalized = named[key] ?? (key.length === 1 ? key.toUpperCase() : key)
  if (!normalized) return null
  parts.push(normalized)
  return parts.join('+')
}
