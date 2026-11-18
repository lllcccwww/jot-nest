import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { Camera, Note, NoteGroup, NoteMove } from '@shared/types'
import { NoteCard } from './NoteCard'
import { GroupFrame, type Rect } from './GroupFrame'

const MIN_ZOOM = 0.25
const MAX_ZOOM = 2
const GRID = 24
const SNAP_THRESHOLD = 6

interface CanvasProps {
  notes: Note[]
  groups: NoteGroup[]
  groupRects: Map<string, Rect>
  camera: Camera
  selection: string[]
  selectedGroup: string | null
  editingId: string | null
  matchIds: Set<string> | null
  heightsRef: React.RefObject<Map<string, number>>
  onCamera: (camera: Camera) => void
  onInterrupt: () => void
  onSelectionChange: (ids: string[]) => void
  onSelectGroup: (id: string | null) => void
  onMoveNotes: (items: NoteMove[]) => void
  onMoveGroup: (groupId: string, dx: number, dy: number) => void
  onEdit: (id: string) => void
  onCommitText: (id: string, text: string) => void
  onMeasure: (id: string, height: number) => void
  onContextMenuCard: (event: React.MouseEvent, id: string) => void
  onContextMenuGroup: (event: React.MouseEvent, id: string) => void
  onOpenImage: (imageId: string) => void
  onBackgroundClick: () => void
}

type Point = { x: number; y: number }

type DragState =
  | {
      kind: 'notes'
      pointerId: number
      ids: string[]
      origins: Map<string, Point>
      startWorld: Point
      startScreen: Point
      dx: number
      dy: number
      moved: boolean
    }
  | {
      kind: 'group'
      pointerId: number
      id: string
      memberIds: string[]
      startScreen: Point
      dx: number
      dy: number
    }
  | { kind: 'pan'; pointerId: number; startScreen: Point; startCamera: Point }
  | {
      kind: 'marquee'
      pointerId: number
      startWorld: Point
      currentWorld: Point
      additive: boolean
      base: string[]
    }

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value))
}

/** 抓取指针：指针移出窗口时仍能收到 pointerup，避免拖拽悬空 */
function capturePointer(event: React.PointerEvent): void {
  const target = event.currentTarget as HTMLElement | null
  try {
    target?.setPointerCapture?.(event.pointerId)
  } catch {
    /* 部分平台/指针类型不支持，忽略即可 */
  }
}

export function Canvas(props: CanvasProps): React.JSX.Element {
  const {
    notes,
    groups,
    groupRects,
    camera,
    selection,
    selectedGroup,
    editingId,
    matchIds,
    heightsRef,
    onCamera,
    onInterrupt,
    onSelectionChange,
    onSelectGroup,
    onMoveNotes,
    onMoveGroup,
    onEdit,
    onCommitText,
    onMeasure,
    onContextMenuCard,
    onContextMenuGroup,
    onOpenImage,
    onBackgroundClick
  } = props

  const containerRef = useRef<HTMLDivElement>(null)
  const dragRef = useRef<DragState | null>(null)
  const [dragTick, setDragTick] = useState(0)
  const [guides, setGuides] = useState<{ x: number[]; y: number[] }>({ x: [], y: [] })
  const [spaceDown, setSpaceDown] = useState(false)
  const notesRef = useRef(notes)
  notesRef.current = notes

  const syncDrag = useCallback(() => setDragTick((tick) => tick + 1), [])

  const toWorld = useCallback(
    (clientX: number, clientY: number): Point => {
      const rect = containerRef.current?.getBoundingClientRect()
      const left = rect?.left ?? 0
      const top = rect?.top ?? 0
      return {
        x: camera.x + (clientX - left) / camera.zoom,
        y: camera.y + (clientY - top) / camera.zoom
      }
    },
    [camera]
  )

  /* ------------------------------- 滚轮 ------------------------------- */

  useEffect(() => {
    const node = containerRef.current
    if (!node) return
    const onWheel = (event: WheelEvent): void => {
      event.preventDefault()
      onInterrupt()
      const rect = node.getBoundingClientRect()
      if (event.ctrlKey) {
        const pointerX = event.clientX - rect.left
        const pointerY = event.clientY - rect.top
        const factor = Math.exp(-event.deltaY * 0.0016)
        const nextZoom = clamp(camera.zoom * factor, MIN_ZOOM, MAX_ZOOM)
        const ratio = nextZoom / camera.zoom
        onCamera({
          zoom: nextZoom,
          x: camera.x + pointerX / camera.zoom - pointerX / nextZoom,
          y: camera.y + pointerY / camera.zoom - pointerY / nextZoom
        })
        void ratio
      } else {
        onCamera({
          zoom: camera.zoom,
          x: camera.x + event.deltaX / camera.zoom,
          y: camera.y + event.deltaY / camera.zoom
        })
      }
    }
    node.addEventListener('wheel', onWheel, { passive: false })
    return () => node.removeEventListener('wheel', onWheel)
  }, [camera, onCamera, onInterrupt])

  /* ------------------------------ 空格平移 ------------------------------ */

  useEffect(() => {
    const down = (event: KeyboardEvent): void => {
      if (event.code === 'Space' && !editingId) setSpaceDown(true)
    }
    const up = (event: KeyboardEvent): void => {
      if (event.code === 'Space') setSpaceDown(false)
    }
    window.addEventListener('keydown', down)
    window.addEventListener('keyup', up)
    return () => {
      window.removeEventListener('keydown', down)
      window.removeEventListener('keyup', up)
    }
  }, [editingId])

  /* ------------------------------ 指针事件 ------------------------------ */

  const beginPan = (event: React.PointerEvent): void => {
    capturePointer(event)
    dragRef.current = {
      kind: 'pan',
      pointerId: event.pointerId,
      startScreen: { x: event.clientX, y: event.clientY },
      startCamera: { x: camera.x, y: camera.y }
    }
    onInterrupt()
    syncDrag()
  }

  const onPointerDown = (event: React.PointerEvent<HTMLDivElement>): void => {
    if (event.button === 1 || (event.button === 0 && spaceDown)) {
      event.preventDefault()
      beginPan(event)
      return
    }
    if (event.button !== 0) return
    if (event.target !== event.currentTarget) return
    const world = toWorld(event.clientX, event.clientY)
    dragRef.current = {
      kind: 'marquee',
      pointerId: event.pointerId,
      startWorld: world,
      currentWorld: world,
      additive: event.shiftKey,
      base: event.shiftKey ? selection : []
    }
    onSelectGroup(null)
    onBackgroundClick()
    if (!event.shiftKey) onSelectionChange([])
    syncDrag()
  }

  const onCardPointerDown = (event: React.PointerEvent, id: string): void => {
    if (event.button !== 0) return
    event.stopPropagation()
    if (editingId === id) return
    // 先结束其他卡片的编辑态（preventDefault 会拦截默认的失焦行为）
    if (editingId) (document.activeElement as HTMLElement | null)?.blur()
    // 阻止浏览器把“按在文字上拖”解释成文本选择/原生拖拽，否则会丢失 pointerup
    event.preventDefault()
    // 注意：卡片上不能调用 setPointerCapture，否则 click 会重定向到卡片，图片点击失效
    const note = notes.find((item) => item.id === id)
    if (!note) return
    onSelectGroup(null)

    let ids: string[]
    if (event.shiftKey) {
      ids = selection.includes(id) ? selection.filter((item) => item !== id) : [...selection, id]
      onSelectionChange(ids)
      if (!ids.includes(id)) return
    } else if (!selection.includes(id)) {
      ids = [id]
      onSelectionChange(ids)
    } else {
      ids = selection
    }

    const origins = new Map<string, Point>()
    for (const noteId of ids) {
      const target = notes.find((item) => item.id === noteId)
      if (target) origins.set(noteId, { x: target.x, y: target.y })
    }
    dragRef.current = {
      kind: 'notes',
      pointerId: event.pointerId,
      ids,
      origins,
      startWorld: toWorld(event.clientX, event.clientY),
      startScreen: { x: event.clientX, y: event.clientY },
      dx: 0,
      dy: 0,
      moved: false
    }
    onInterrupt()
    syncDrag()
  }

  const onGroupPointerDown = (event: React.PointerEvent, groupId: string): void => {
    if (event.button !== 0) return
    event.stopPropagation()
    event.preventDefault()
    onSelectionChange([])
    onSelectGroup(groupId)
    const memberIds = notes.filter((note) => note.groupId === groupId).map((note) => note.id)
    dragRef.current = {
      kind: 'group',
      pointerId: event.pointerId,
      id: groupId,
      memberIds,
      startScreen: { x: event.clientX, y: event.clientY },
      dx: 0,
      dy: 0
    }
    onInterrupt()
    syncDrag()
  }

  useEffect(() => {
    const finishDrag = (event?: PointerEvent): void => {
      const drag = dragRef.current
      // 只接受发起拖拽的那只指针；其他设备（真实鼠标、触摸）的事件不参与
      if (drag && event && event.pointerId !== drag.pointerId) return
      dragRef.current = null
      setGuides({ x: [], y: [] })
      if (!drag) return
      if (drag.kind === 'notes' && drag.moved) {
        onMoveNotes(
          drag.ids.map((id) => {
            const origin = drag.origins.get(id)
            return { id, x: Math.round((origin?.x ?? 0) + drag.dx), y: Math.round((origin?.y ?? 0) + drag.dy) }
          })
        )
      }
      if (drag.kind === 'group' && (drag.dx !== 0 || drag.dy !== 0)) {
        onMoveGroup(drag.id, Math.round(drag.dx), Math.round(drag.dy))
      }
      syncDrag()
    }

    const onMove = (event: PointerEvent): void => {
      const drag = dragRef.current
      if (!drag) return
      if (event.pointerId !== drag.pointerId) return
      // 同一只指针丢了 pointerup 后继续收到 buttons=0 的移动，视为拖拽结束
      if (event.buttons === 0) {
        finishDrag()
        return
      }
      if (drag.kind === 'pan') {
        const zoom = camera.zoom
        onCamera({
          zoom,
          x: drag.startCamera.x - (event.clientX - drag.startScreen.x) / zoom,
          y: drag.startCamera.y - (event.clientY - drag.startScreen.y) / zoom
        })
        return
      }
      if (drag.kind === 'marquee') {
        drag.currentWorld = toWorld(event.clientX, event.clientY)
        const rect = marqueeRect(drag.startWorld, drag.currentWorld)
        const hits = notesRef.current
          .filter((note) => {
            const height = heightsRef.current.get(note.id) ?? 120
            return intersects(rect, { x: note.x, y: note.y, w: note.width, h: height })
          })
          .map((note) => note.id)
        const merged = drag.additive ? [...new Set([...drag.base, ...hits])] : hits
        onSelectionChange(merged)
        syncDrag()
        return
      }
      if (drag.kind === 'notes') {
        let dx = (event.clientX - drag.startScreen.x) / camera.zoom
        let dy = (event.clientY - drag.startScreen.y) / camera.zoom
        const nextGuides = { x: [] as number[], y: [] as number[] }
        if (!event.altKey) {
          const snapped = computeSnap({ drag, notes: notesRef.current, heights: heightsRef.current, dx, dy })
          dx = snapped.dx
          dy = snapped.dy
          nextGuides.x = snapped.guidesX
          nextGuides.y = snapped.guidesY
        }
        drag.dx = dx
        drag.dy = dy
        drag.moved = drag.moved || Math.abs(dx) > 0.5 || Math.abs(dy) > 0.5
        setGuides(nextGuides)
        syncDrag()
        return
      }
      if (drag.kind === 'group') {
        drag.dx = (event.clientX - drag.startScreen.x) / camera.zoom
        drag.dy = (event.clientY - drag.startScreen.y) / camera.zoom
        syncDrag()
      }
    }

    window.addEventListener('pointermove', onMove)
    window.addEventListener('pointerup', finishDrag)
    window.addEventListener('pointercancel', finishDrag)
    return () => {
      window.removeEventListener('pointermove', onMove)
      window.removeEventListener('pointerup', finishDrag)
      window.removeEventListener('pointercancel', finishDrag)
    }
  }, [camera.zoom, heightsRef, onCamera, onMoveGroup, onMoveNotes, onSelectionChange, syncDrag, toWorld])

  /* ------------------------------ 渲染 ------------------------------ */

  const drag = dragRef.current
  const draggingIds = drag?.kind === 'notes' && drag.moved ? new Set(drag.ids) : new Set<string>()
  const dragGroupOffset =
    drag?.kind === 'group' && (drag.dx !== 0 || drag.dy !== 0)
      ? { id: drag.id, dx: drag.dx, dy: drag.dy, memberIds: new Set(drag.memberIds) }
      : null

  const marquee =
    drag?.kind === 'marquee' ? marqueeRect(drag.startWorld, drag.currentWorld) : null

  const orderedGroups = useMemo(
    () => [...groups].sort((a, b) => a.createdAt - b.createdAt),
    [groups]
  )

  return (
    <div
      className="canvas"
      ref={containerRef}
      data-mode={spaceDown ? 'pan' : undefined}
      data-dragging={dragRef.current ? 'true' : undefined}
      onPointerDown={onPointerDown}
      style={{
        backgroundSize: `${GRID * camera.zoom}px ${GRID * camera.zoom}px`,
        backgroundPosition: `${-camera.x * camera.zoom}px ${-camera.y * camera.zoom}px`
      }}
    >
      <div
        className="world"
        style={{ transform: `translate3d(${-camera.x * camera.zoom}px, ${-camera.y * camera.zoom}px, 0) scale(${camera.zoom})` }}
      >
        {orderedGroups.map((group) => {
          const rect = groupRects.get(group.id)
          if (!rect) return null
          const offset = dragGroupOffset?.id === group.id ? dragGroupOffset : null
          return (
            <GroupFrame
              key={group.id}
              group={group}
              rect={rect}
              selected={selectedGroup === group.id}
              memberCount={notes.filter((note) => note.groupId === group.id).length}
              offset={offset ? { dx: offset.dx, dy: offset.dy } : null}
              onPointerDownHeader={onGroupPointerDown}
              onContextMenu={onContextMenuGroup}
            />
          )
        })}

        {notes.map((note) => {
          const groupCollapsed = note.groupId
            ? groups.find((group) => group.id === note.groupId)?.collapsed === true
            : false
          const offset = draggingIds.has(note.id)
            ? { dx: drag && drag.kind === 'notes' ? drag.dx : 0, dy: drag && drag.kind === 'notes' ? drag.dy : 0 }
            : dragGroupOffset && dragGroupOffset.memberIds.has(note.id)
              ? { dx: dragGroupOffset.dx, dy: dragGroupOffset.dy }
              : null
          return (
            <NoteCard
              key={note.id}
              note={note}
              selected={selection.includes(note.id)}
              editing={editingId === note.id}
              dimmed={matchIds !== null && !matchIds.has(note.id)}
              matched={matchIds !== null && matchIds.has(note.id)}
              collapsed={groupCollapsed}
              offset={offset}
              dragged={draggingIds.has(note.id) && Math.abs(offset?.dx ?? 0) + Math.abs(offset?.dy ?? 0) > 0.5}
              onPointerDown={onCardPointerDown}
              onDoubleClick={onEdit}
              onCommitText={onCommitText}
              onMeasure={onMeasure}
              onContextMenu={onContextMenuCard}
              onOpenImage={onOpenImage}
            />
          )
        })}

        {guides.x.map((x) => (
          <div key={`gx-${x}`} className="snap-guide vertical" style={{ left: x, top: -20000, height: 40000 }} />
        ))}
        {guides.y.map((y) => (
          <div key={`gy-${y}`} className="snap-guide horizontal" style={{ top: y, left: -20000, width: 40000 }} />
        ))}
      </div>

      {marquee && (
        <div
          className="marquee"
          style={{
            left: (marquee.x - camera.x) * camera.zoom,
            top: (marquee.y - camera.y) * camera.zoom,
            width: marquee.w * camera.zoom,
            height: marquee.h * camera.zoom
          }}
        />
      )}
      {/* dragTick 用于把内部 ref 的变化同步到渲染 */}
      <span hidden>{dragTick}</span>
      {notes.length === 0 && <EmptyState />}
    </div>
  )
}

function EmptyState(): React.JSX.Element {
  return (
    <div className="empty">
      <div className="empty-inner">
        <div className="empty-stack">
          <span />
          <span />
          <span>
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6">
              <path d="M4 7h16M4 12h10M4 17h7" strokeLinecap="round" />
            </svg>
          </span>
        </div>
        <div className="empty-title">画布还是空的</div>
        <div className="empty-hint">
          按 <span className="kbd">Ctrl</span>
          <span className="kbd">Alt</span>
          <span className="kbd">N</span> 随手记一条
        </div>
      </div>
    </div>
  )
}

function marqueeRect(a: Point, b: Point): Rect {
  return {
    x: Math.min(a.x, b.x),
    y: Math.min(a.y, b.y),
    w: Math.abs(a.x - b.x),
    h: Math.abs(a.y - b.y)
  }
}

function intersects(a: Rect, b: Rect): boolean {
  return a.x < b.x + b.w && a.x + a.w > b.x && a.y < b.y + b.h && a.y + a.h > b.y
}

function computeSnap(input: {
  drag: Extract<DragState, { kind: 'notes' }>
  notes: Note[]
  heights: Map<string, number>
  dx: number
  dy: number
}): { dx: number; dy: number; guidesX: number[]; guidesY: number[] } {
  const { drag, notes, heights } = input
  const primaryId = drag.ids[0]
  const origin = drag.origins.get(primaryId)
  const note = notes.find((item) => item.id === primaryId)
  if (!origin || !note) return { dx: input.dx, dy: input.dy, guidesX: [], guidesY: [] }

  const height = heights.get(note.id) ?? 120
  const left = origin.x + input.dx
  const top = origin.y + input.dy
  const right = left + note.width
  const bottom = top + height

  const targetsX: number[] = []
  const targetsY: number[] = []
  for (const other of notes) {
    if (drag.ids.includes(other.id)) continue
    const otherHeight = heights.get(other.id) ?? 120
    targetsX.push(other.x, other.x + other.width / 2, other.x + other.width)
    targetsY.push(other.y, other.y + otherHeight / 2, other.y + otherHeight)
  }

  const findSnap = (
    values: number[],
    candidates: number[],
    threshold: number
  ): { delta: number; guide: number } | null => {
    let best: { delta: number; guide: number } | null = null
    for (const value of values) {
      for (const candidate of candidates) {
        const delta = candidate - value
        if (Math.abs(delta) > threshold) continue
        if (!best || Math.abs(delta) < Math.abs(best.delta)) best = { delta, guide: candidate }
      }
    }
    return best
  }

  const threshold = SNAP_THRESHOLD
  const snapX = findSnap([left, left + note.width / 2, right], targetsX, threshold)
  const snapY = findSnap([top, top + height / 2, bottom], targetsY, threshold)

  return {
    dx: input.dx + (snapX?.delta ?? 0),
    dy: input.dy + (snapY?.delta ?? 0),
    guidesX: snapX ? [snapX.guide] : [],
    guidesY: snapY ? [snapY.guide] : []
  }
}
