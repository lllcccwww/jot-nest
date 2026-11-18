import { useEffect, useRef } from 'react'
import type { CardColor } from '@shared/types'
import { CARD_COLORS } from '@shared/types'
import { colorLabel } from '../lib/format'

export type MenuEntry =
  | { kind: 'item'; label: string; icon?: React.ReactNode; danger?: boolean; hint?: string; onSelect: () => void }
  | { kind: 'separator' }
  | { kind: 'label'; text: string }
  | { kind: 'colors'; active: CardColor; onSelect: (color: CardColor) => void }

export interface ContextMenuProps {
  x: number
  y: number
  entries: MenuEntry[]
  onClose: () => void
}

export function ContextMenu({ x, y, entries, onClose }: ContextMenuProps): React.JSX.Element {
  const ref = useRef<HTMLDivElement>(null)

  useEffect(() => {
    const onPointerDown = (event: PointerEvent): void => {
      if (ref.current && !ref.current.contains(event.target as Node)) onClose()
    }
    const onKeyDown = (event: KeyboardEvent): void => {
      if (event.key === 'Escape') onClose()
    }
    window.addEventListener('pointerdown', onPointerDown, true)
    window.addEventListener('keydown', onKeyDown)
    return () => {
      window.removeEventListener('pointerdown', onPointerDown, true)
      window.removeEventListener('keydown', onKeyDown)
    }
  }, [onClose])

  const style: React.CSSProperties = {
    left: Math.min(x, window.innerWidth - 200),
    top: Math.min(y, window.innerHeight - entries.length * 32 - 24)
  }

  return (
    <div className="menu" ref={ref} style={style} onContextMenu={(event) => event.preventDefault()}>
      {entries.map((entry, index) => {
        if (entry.kind === 'separator') return <div key={`sep-${index}`} className="menu-separator" />
        if (entry.kind === 'label') {
          return (
            <div key={`label-${index}`} className="menu-label">
              {entry.text}
            </div>
          )
        }
        if (entry.kind === 'colors') {
          return (
            <div key={`colors-${index}`} className="menu-swatches">
              {CARD_COLORS.map((color) => (
                <button
                  key={color}
                  className="swatch"
                  data-color={color}
                  data-active={entry.active === color}
                  title={colorLabel(color)}
                  onClick={() => {
                    entry.onSelect(color)
                    onClose()
                  }}
                />
              ))}
            </div>
          )
        }
        return (
          <button
            key={entry.label}
            className={`menu-item${entry.danger ? ' danger' : ''}`}
            onClick={() => {
              entry.onSelect()
              onClose()
            }}
          >
            {entry.icon}
            <span>{entry.label}</span>
            {entry.hint && <span className="right">{entry.hint}</span>}
          </button>
        )
      })}
    </div>
  )
}
