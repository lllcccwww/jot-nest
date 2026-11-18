import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import type { Note } from '@shared/types'
import { isFresh, relativeTime } from '../lib/format'
import { renderMarkdown } from '../lib/markdown'

const COLLAPSED_MAX_HEIGHT = 262

interface NoteCardProps {
  note: Note
  selected: boolean
  editing: boolean
  dimmed: boolean
  matched: boolean
  collapsed: boolean
  dragged: boolean
  offset: { dx: number; dy: number } | null
  onPointerDown: (event: React.PointerEvent, id: string) => void
  onDoubleClick: (id: string) => void
  onCommitText: (id: string, text: string) => void
  onMeasure: (id: string, height: number) => void
  onContextMenu: (event: React.MouseEvent, id: string) => void
  onOpenImage: (imageId: string) => void
}

export function NoteCard(props: NoteCardProps): React.JSX.Element {
  const {
    note,
    selected,
    editing,
    dimmed,
    matched,
    collapsed,
    dragged,
    offset,
    onPointerDown,
    onDoubleClick,
    onCommitText,
    onMeasure,
    onContextMenu,
    onOpenImage
  } = props

  const rootRef = useRef<HTMLDivElement>(null)
  const textRef = useRef<HTMLDivElement>(null)
  const textareaRef = useRef<HTMLTextAreaElement>(null)
  const [expanded, setExpanded] = useState(false)
  const [overflowing, setOverflowing] = useState(false)
  const [draft, setDraft] = useState(note.text)

  useEffect(() => {
    if (editing) {
      setDraft(note.text)
      requestAnimationFrame(() => {
        const node = textareaRef.current
        if (!node) return
        node.focus()
        node.setSelectionRange(node.value.length, node.value.length)
        autosize(node)
      })
    }
  }, [editing, note.text])

  useLayoutEffect(() => {
    const node = rootRef.current
    if (!node) return
    const observer = new ResizeObserver(() => {
      onMeasure(note.id, node.offsetHeight)
    })
    observer.observe(node)
    onMeasure(note.id, node.offsetHeight)
    return () => observer.disconnect()
  }, [note.id, onMeasure])

  useLayoutEffect(() => {
    if (editing || note.kind !== 'text') return
    const node = textRef.current
    if (!node) return
    setOverflowing(node.scrollHeight > node.clientHeight + 2)
  }, [editing, note.text, note.kind, note.width, expanded])

  const commit = (): void => {
    if (draft !== note.text) onCommitText(note.id, draft)
    else onCommitText(note.id, note.text)
  }

  // 编辑态被意外卸载（例如点击画布空白处）时，也要把草稿落库
  const draftRef = useRef(draft)
  const noteTextRef = useRef(note.text)
  draftRef.current = draft
  noteTextRef.current = note.text
  useEffect(() => {
    if (!editing) return
    return () => {
      if (draftRef.current !== noteTextRef.current) onCommitText(note.id, draftRef.current)
    }
  }, [editing, note.id, onCommitText])

  const style: React.CSSProperties = {
    left: note.x,
    top: note.y,
    width: note.width,
    zIndex: dragged ? 900 : Math.floor(note.z % 1000),
    transform: offset ? `translate3d(${offset.dx}px, ${offset.dy}px, 0)` : undefined
  }

  return (
    <div
      ref={rootRef}
      className="card"
      data-note-id={note.id}
      data-selected={selected}
      data-dimmed={dimmed}
      data-matched={matched}
      data-color={note.color === 'none' ? undefined : note.color}
      data-dragging={dragged}
      data-collapsed={collapsed}
      style={style}
      onPointerDown={(event) => onPointerDown(event, note.id)}
      onDoubleClick={(event) => {
        event.stopPropagation()
        if (!editing) onDoubleClick(note.id)
      }}
      onContextMenu={(event) => {
        event.preventDefault()
        event.stopPropagation()
        onContextMenu(event, note.id)
      }}
    >
      <div className="card-head">
        <span>{relativeTime(note.createdAt)}</span>
        {note.pinned && (
          <span className="card-pin" title="已收藏">
            <svg width="11" height="11" viewBox="0 0 24 24" fill="currentColor" aria-hidden>
              <path d="M12 3l2.6 5.7 6.2.7-4.6 4.2 1.2 6.1L12 16.8 6.6 19.7l1.2-6.1L3.2 9.4l6.2-.7z" />
            </svg>
          </span>
        )}
        <span className="spacer" />
        {isFresh(note.createdAt) && <span className="card-fresh" title="最近添加" />}
      </div>

      {note.kind === 'image' && note.imageId && (
        <img
          className="card-image"
          src={`jot://img/${note.imageId}`}
          alt=""
          draggable={false}
          onClick={(event) => {
            event.stopPropagation()
            onOpenImage(note.imageId as string)
          }}
        />
      )}

      {editing ? (
        <textarea
          ref={textareaRef}
          className="card-edit"
          value={draft}
          placeholder="写点什么…"
          onChange={(event) => {
            setDraft(event.target.value)
            autosize(event.target)
          }}
          onPointerDown={(event) => event.stopPropagation()}
          onDoubleClick={(event) => event.stopPropagation()}
          onBlur={commit}
          onKeyDown={(event) => {
            if (event.key === 'Escape') {
              event.preventDefault()
              setDraft(note.text)
              onCommitText(note.id, note.text)
            }
            if (event.key === 'Enter' && (event.ctrlKey || event.metaKey)) {
              event.preventDefault()
              commit()
            }
          }}
        />
      ) : (
        note.text.length > 0 && (
          <>
            <div
              ref={textRef}
              className="card-body"
              data-collapsed={!expanded && overflowing}
              style={!expanded ? { maxHeight: COLLAPSED_MAX_HEIGHT } : undefined}
              onClick={(event) => {
                const anchor = (event.target as HTMLElement).closest('a')
                if (anchor) {
                  event.preventDefault()
                  const href = anchor.getAttribute('href')
                  if (href) void window.jot.app.openExternal(href)
                }
              }}
              dangerouslySetInnerHTML={{ __html: renderMarkdown(note.text) }}
            />
            {overflowing && !expanded && (
              <button
                className="card-expand"
                onPointerDown={(event) => event.stopPropagation()}
                onClick={(event) => {
                  event.stopPropagation()
                  setExpanded(true)
                }}
              >
                展开
              </button>
            )}
          </>
        )
      )}

      {note.tags.length > 0 && (
        <div className="card-tags">
          {note.tags.map((tag) => (
            <span key={tag} className="tag">
              {tag}
            </span>
          ))}
        </div>
      )}
    </div>
  )
}

function autosize(node: HTMLTextAreaElement): void {
  node.style.height = 'auto'
  node.style.height = `${node.scrollHeight}px`
}
