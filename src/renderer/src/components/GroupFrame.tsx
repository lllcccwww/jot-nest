import type { NoteGroup } from '@shared/types'

export interface Rect {
  x: number
  y: number
  w: number
  h: number
}

export const GROUP_HEADER_HEIGHT = 38
export const GROUP_PADDING = 16

interface GroupFrameProps {
  group: NoteGroup
  rect: Rect
  selected: boolean
  memberCount: number
  offset: { dx: number; dy: number } | null
  onPointerDownHeader: (event: React.PointerEvent, groupId: string) => void
  onContextMenu: (event: React.MouseEvent, groupId: string) => void
}

export function GroupFrame(props: GroupFrameProps): React.JSX.Element {
  const { group, rect, selected, memberCount, offset, onPointerDownHeader, onContextMenu } = props
  const dx = offset?.dx ?? 0
  const dy = offset?.dy ?? 0

  return (
    <div
      className="group-frame"
      data-group-id={group.id}
      data-selected={selected}
      data-color={group.color === 'none' ? undefined : group.color}
      style={{
        left: rect.x,
        top: rect.y,
        width: rect.w,
        height: rect.h,
        transform: dx || dy ? `translate3d(${dx}px, ${dy}px, 0)` : undefined,
        paddingTop: GROUP_HEADER_HEIGHT
      }}
      onContextMenu={(event) => {
        event.stopPropagation()
        onContextMenu(event, group.id)
      }}
    >
      <div className="group-head" onPointerDown={(event) => onPointerDownHeader(event, group.id)}>
        <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" aria-hidden>
          <path d="M4 7h6l2 2h8v10H4z" strokeLinejoin="round" />
        </svg>
        <span className="group-title">{group.title || '未命名分组'}</span>
        <span className="group-count">{memberCount}</span>
        <span style={{ flex: 1 }} />
      </div>
    </div>
  )
}
