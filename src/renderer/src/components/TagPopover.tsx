import { useEffect, useRef, useState } from 'react'
import type { TagCount } from '@shared/types'

interface TagPopoverProps {
  x: number
  y: number
  allTags: TagCount[]
  selected: string[]
  onChange: (tags: string[]) => void
  onClose: () => void
}

export function TagPopover({ x, y, allTags, selected, onChange, onClose }: TagPopoverProps): React.JSX.Element {
  const ref = useRef<HTMLDivElement>(null)
  const [value, setValue] = useState('')

  useEffect(() => {
    const onPointerDown = (event: PointerEvent): void => {
      if (ref.current && !ref.current.contains(event.target as Node)) onClose()
    }
    window.addEventListener('pointerdown', onPointerDown, true)
    return () => window.removeEventListener('pointerdown', onPointerDown, true)
  }, [onClose])

  const add = (tag: string): void => {
    const trimmed = tag.trim()
    if (!trimmed || selected.includes(trimmed)) {
      setValue('')
      return
    }
    onChange([...selected, trimmed])
    setValue('')
  }

  const suggestions = allTags.filter(
    (tag) => !selected.includes(tag.tag) && (value === '' || tag.tag.includes(value.trim()))
  )

  return (
    <div
      className="popover"
      ref={ref}
      style={{ left: Math.min(x, window.innerWidth - 264), top: Math.min(y, window.innerHeight - 220) }}
    >
      <input
        className="popover-input"
        autoFocus
        value={value}
        placeholder="输入标签，回车添加"
        onChange={(event) => setValue(event.target.value)}
        onKeyDown={(event) => {
          if (event.key === 'Enter') {
            event.preventDefault()
            add(value)
          }
          if (event.key === 'Escape') onClose()
        }}
      />
      <div className="popover-tags">
        {selected.map((tag) => (
          <button key={tag} className="chip" data-active="true" onClick={() => onChange(selected.filter((item) => item !== tag))}>
            {tag}
            <span aria-hidden>×</span>
          </button>
        ))}
        {suggestions.map((tag) => (
          <button key={tag.tag} className="chip" onClick={() => add(tag.tag)}>
            {tag.tag}
            <span style={{ color: 'var(--text-faint)' }}>{tag.count}</span>
          </button>
        ))}
      </div>
    </div>
  )
}

interface PromptPopoverProps {
  x: number
  y: number
  title: string
  initial: string
  onSubmit: (value: string) => void
  onClose: () => void
}

export function PromptPopover({ x, y, title, initial, onSubmit, onClose }: PromptPopoverProps): React.JSX.Element {
  const ref = useRef<HTMLDivElement>(null)
  const [value, setValue] = useState(initial)

  useEffect(() => {
    const onPointerDown = (event: PointerEvent): void => {
      if (ref.current && !ref.current.contains(event.target as Node)) onClose()
    }
    window.addEventListener('pointerdown', onPointerDown, true)
    return () => window.removeEventListener('pointerdown', onPointerDown, true)
  }, [onClose])

  return (
    <div
      className="popover"
      ref={ref}
      style={{ left: Math.min(x, window.innerWidth - 264), top: Math.min(y, window.innerHeight - 120) }}
    >
      <div className="menu-label" style={{ padding: '0 0 6px' }}>
        {title}
      </div>
      <input
        className="popover-input"
        autoFocus
        value={value}
        onChange={(event) => setValue(event.target.value)}
        onKeyDown={(event) => {
          if (event.key === 'Enter') {
            event.preventDefault()
            onSubmit(value.trim())
            onClose()
          }
          if (event.key === 'Escape') onClose()
        }}
        onBlur={() => {
          onSubmit(value.trim())
          onClose()
        }}
      />
    </div>
  )
}
