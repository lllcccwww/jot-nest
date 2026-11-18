import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { DEFAULT_CAMERA } from '@shared/types'
import type {
  AppSettings,
  BackupState,
  Camera,
  CardColor,
  CardWidth,
  Note,
  NoteGroup
} from '@shared/types'
import type { TagCount } from '@shared/types'
import { EVENTS } from '@shared/ipc'
import { Canvas } from './components/Canvas'
import { GROUP_HEADER_HEIGHT, GROUP_PADDING, type Rect } from './components/GroupFrame'
import { ContextMenu, type MenuEntry } from './components/ContextMenu'
import { PromptPopover, TagPopover } from './components/TagPopover'
import { Lightbox, Toasts, type ToastItem } from './components/Overlays'
import { SettingsDialog } from './components/SettingsDialog'
import { formatAccelerator } from './lib/format'

const MIN_ZOOM = 0.25
const MAX_ZOOM = 2
const TITLEBAR_HEIGHT = 48

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value))
}

interface PromptState {
  x: number
  y: number
  title: string
  initial: string
  onSubmit: (value: string) => void
}

interface TagEditorState {
  x: number
  y: number
  ids: string[]
  selected: string[]
}

export function App(): React.JSX.Element {
  const [notes, setNotes] = useState<Note[]>([])
  const [groups, setGroups] = useState<NoteGroup[]>([])
  const [camera, setCamera] = useState<Camera>(DEFAULT_CAMERA)
  const [viewport, setViewport] = useState({ w: window.innerWidth, h: window.innerHeight })
  const [loaded, setLoaded] = useState(false)
  const [selection, setSelection] = useState<string[]>([])
  const [selectedGroup, setSelectedGroup] = useState<string | null>(null)
  const [editingId, setEditingId] = useState<string | null>(null)
  const [query, setQuery] = useState('')
  const [pinnedOnly, setPinnedOnly] = useState(false)
  const [filterTags, setFilterTags] = useState<string[]>([])
  const [matchIds, setMatchIds] = useState<Set<string> | null>(null)
  const [matchOrder, setMatchOrder] = useState<string[]>([])
  const [allTags, setAllTags] = useState<TagCount[]>([])
  const [settings, setSettings] = useState<AppSettings | null>(null)
  const [backupState, setBackupState] = useState<BackupState>({ status: 'idle' })
  const [settingsOpen, setSettingsOpen] = useState(false)
  const [lightbox, setLightbox] = useState<string | null>(null)
  const [toasts, setToasts] = useState<ToastItem[]>([])
  const [menu, setMenu] = useState<{ x: number; y: number; entries: MenuEntry[] } | null>(null)
  const [tagEditor, setTagEditor] = useState<TagEditorState | null>(null)
  const [tagFilterAnchor, setTagFilterAnchor] = useState<{ x: number; y: number } | null>(null)
  const [prompt, setPrompt] = useState<PromptState | null>(null)
  const [maximized, setMaximized] = useState(false)
  const [refreshTick, setRefreshTick] = useState(0)

  const cameraRef = useRef(camera)
  const notesRef = useRef(notes)
  const groupsRef = useRef(groups)
  const viewportRef = useRef(viewport)
  const heightsRef = useRef(new Map<string, number>())
  const measureRaf = useRef<number | null>(null)
  const animRef = useRef<number | null>(null)
  const searchRef = useRef<HTMLInputElement>(null)

  cameraRef.current = camera
  notesRef.current = notes
  groupsRef.current = groups
  viewportRef.current = viewport

  const applyCamera = useCallback((next: Camera) => {
    cameraRef.current = next
    setCamera(next)
  }, [])

  const stopAnimation = useCallback(() => {
    if (animRef.current !== null) {
      cancelAnimationFrame(animRef.current)
      animRef.current = null
    }
  }, [])

  const animateCamera = useCallback(
    (target: Camera) => {
      stopAnimation()
      const start = cameraRef.current
      const started = performance.now()
      const step = (now: number): void => {
        const progress = Math.min(1, (now - started) / 360)
        const eased = 1 - Math.pow(1 - progress, 3)
        applyCamera({
          x: start.x + (target.x - start.x) * eased,
          y: start.y + (target.y - start.y) * eased,
          zoom: start.zoom + (target.zoom - start.zoom) * eased
        })
        if (progress < 1) animRef.current = requestAnimationFrame(step)
        else animRef.current = null
      }
      animRef.current = requestAnimationFrame(step)
    },
    [applyCamera, stopAnimation]
  )

  useEffect(() => () => stopAnimation(), [stopAnimation])

  const toast = useCallback((text: string) => {
    const id = Date.now() + Math.random()
    setToasts((current) => [...current, { id, text }])
    setTimeout(() => {
      setToasts((current) => current.filter((item) => item.id !== id))
    }, 2400)
  }, [])

  const refresh = useCallback(async () => {
    const snapshot = await window.jot.board.get()
    setNotes(snapshot.notes)
    setGroups(snapshot.groups)
    setAllTags(await window.jot.board.tags())
  }, [])

  /* ------------------------------ 初始化 ------------------------------ */

  useEffect(() => {
    let cancelled = false
    void (async () => {
      const snapshot = await window.jot.board.get()
      if (cancelled) return
      setNotes(snapshot.notes)
      setGroups(snapshot.groups)
      applyCamera(snapshot.camera)
      setAllTags(await window.jot.board.tags())
      setSettings(await window.jot.settings.get())
      setBackupState(await window.jot.backup.state())
      setLoaded(true)
    })()
    return () => {
      cancelled = true
    }
  }, [applyCamera])

  const flyToNote = useCallback(
    (noteId: string) => {
      const note = notesRef.current.find((item) => item.id === noteId)
      if (!note) return
      const group = note.groupId ? groupsRef.current.find((item) => item.id === note.groupId) : null
      if (group?.collapsed) void window.jot.board.updateGroup(group.id, { collapsed: false })
      const zoom = Math.max(cameraRef.current.zoom, 0.9)
      const height = heightsRef.current.get(note.id) ?? 160
      const { w, h } = viewportRef.current
      const canvasHeight = h - TITLEBAR_HEIGHT
      animateCamera({
        zoom,
        x: note.x + note.width / 2 - w / 2 / zoom,
        y: note.y + height / 2 - (TITLEBAR_HEIGHT + canvasHeight / 2) / zoom
      })
      setSelection([note.id])
      setSelectedGroup(null)
    },
    [animateCamera]
  )

  useEffect(() => {
    const offs = [
      window.jot.on(EVENTS.boardChanged, () => void refresh()),
      window.jot.on(EVENTS.settingsChanged, (payload) => setSettings(payload as AppSettings)),
      window.jot.on(EVENTS.backupState, (payload) => setBackupState(payload as BackupState)),
      window.jot.on(EVENTS.windowState, (payload) => setMaximized((payload as { maximized: boolean }).maximized)),
      window.jot.on(EVENTS.locateNote, (payload) => flyToNote((payload as { id: string }).id)),
      window.jot.on(EVENTS.flyToRecent, (payload) => {
        if (document.hasFocus()) flyToNote((payload as { id: string }).id)
      })
    ]
    return () => offs.forEach((off) => off())
  }, [flyToNote, refresh])

  /* --------------------------- 主题与视口 --------------------------- */

  useEffect(() => {
    if (!settings) return
    const media = window.matchMedia('(prefers-color-scheme: dark)')
    const apply = (): void => {
      const theme = settings.theme === 'system' ? (media.matches ? 'dark' : 'light') : settings.theme
      document.documentElement.dataset.theme = theme
    }
    apply()
    media.addEventListener('change', apply)
    return () => media.removeEventListener('change', apply)
  }, [settings])

  useEffect(() => {
    const update = (): void => setViewport({ w: window.innerWidth, h: window.innerHeight })
    window.addEventListener('resize', update)
    return () => window.removeEventListener('resize', update)
  }, [])

  useEffect(() => {
    if (!loaded) return
    const timer = setTimeout(() => {
      void window.jot.board.setCamera(camera, viewport)
    }, 450)
    return () => clearTimeout(timer)
  }, [camera, viewport, loaded])

  /* ------------------------------ 搜索 ------------------------------ */

  useEffect(() => {
    const text = query.trim()
    if (!text && filterTags.length === 0 && !pinnedOnly) {
      setMatchIds(null)
      setMatchOrder([])
      return
    }
    const timer = setTimeout(() => {
      void (async () => {
        const results = await window.jot.board.search({ text, tags: filterTags, pinnedOnly })
        setMatchIds(new Set(results.map((note) => note.id)))
        setMatchOrder(results.map((note) => note.id))
      })()
    }, 150)
    return () => clearTimeout(timer)
  }, [query, filterTags, pinnedOnly])

  /* ------------------------------ 测量 ------------------------------ */

  const onMeasure = useCallback((id: string, height: number) => {
    const previous = heightsRef.current.get(id)
    if (previous !== undefined && Math.abs(previous - height) < 0.5) return
    heightsRef.current.set(id, height)
    if (measureRaf.current !== null) return
    measureRaf.current = requestAnimationFrame(() => {
      measureRaf.current = null
      setRefreshTick((tick) => tick + 1)
    })
  }, [])

  useEffect(
    () => () => {
      if (measureRaf.current !== null) cancelAnimationFrame(measureRaf.current)
    },
    []
  )

  const groupRects = useMemo(() => {
    const map = new Map<string, Rect>()
    for (const group of groups) {
      const members = notes.filter((note) => note.groupId === group.id)
      if (members.length === 0) continue
      let minX = Number.POSITIVE_INFINITY
      let minY = Number.POSITIVE_INFINITY
      let maxX = Number.NEGATIVE_INFINITY
      let maxY = Number.NEGATIVE_INFINITY
      for (const member of members) {
        const height = heightsRef.current.get(member.id) ?? 120
        minX = Math.min(minX, member.x)
        minY = Math.min(minY, member.y)
        maxX = Math.max(maxX, member.x + member.width)
        maxY = Math.max(maxY, member.y + height)
      }
      map.set(group.id, {
        x: minX - GROUP_PADDING,
        y: minY - GROUP_PADDING - GROUP_HEADER_HEIGHT,
        w: maxX - minX + GROUP_PADDING * 2,
        h: group.collapsed
          ? GROUP_HEADER_HEIGHT + GROUP_PADDING
          : maxY - minY + GROUP_PADDING * 2 + GROUP_HEADER_HEIGHT
      })
    }
    return map
  }, [groups, notes, refreshTick])

  /* ---------------------------- 视图操作 ---------------------------- */

  const fitAll = useCallback(() => {
    const items = notesRef.current
    if (items.length === 0) {
      animateCamera({ x: 0, y: 0, zoom: 1 })
      return
    }
    let minX = Number.POSITIVE_INFINITY
    let minY = Number.POSITIVE_INFINITY
    let maxX = Number.NEGATIVE_INFINITY
    let maxY = Number.NEGATIVE_INFINITY
    for (const note of items) {
      const height = heightsRef.current.get(note.id) ?? 120
      minX = Math.min(minX, note.x)
      minY = Math.min(minY, note.y)
      maxX = Math.max(maxX, note.x + note.width)
      maxY = Math.max(maxY, note.y + height)
    }
    const { w, h } = viewportRef.current
    const canvasHeight = h - TITLEBAR_HEIGHT
    const zoom = clamp(
      Math.min((w - 80) / (maxX - minX + 160), (canvasHeight - 80) / (maxY - minY + 160)),
      MIN_ZOOM,
      1
    )
    animateCamera({
      zoom,
      x: (minX + maxX) / 2 - w / 2 / zoom,
      y: (minY + maxY) / 2 - (TITLEBAR_HEIGHT + canvasHeight / 2) / zoom
    })
  }, [animateCamera])

  const zoomBy = useCallback(
    (factor: number) => {
      const { w, h } = viewportRef.current
      const canvasHeight = h - TITLEBAR_HEIGHT
      const current = cameraRef.current
      const nextZoom = clamp(current.zoom * factor, MIN_ZOOM, MAX_ZOOM)
      animateCamera({
        zoom: nextZoom,
        x: current.x + w / 2 / current.zoom - w / 2 / nextZoom,
        y:
          current.y +
          (TITLEBAR_HEIGHT + canvasHeight / 2) / current.zoom -
          (TITLEBAR_HEIGHT + canvasHeight / 2) / nextZoom
      })
    },
    [animateCamera]
  )

  /* ---------------------------- 数据变更 ---------------------------- */

  const commitText = useCallback((id: string, text: string) => {
    setEditingId(null)
    void window.jot.board.updateNote(id, { text })
  }, [])

  const createNote = useCallback(async () => {
    const current = cameraRef.current
    const { w, h } = viewportRef.current
    const note = await window.jot.board.createNote({
      kind: 'text',
      text: '',
      x: Math.round(current.x + w / 2 / current.zoom - 160),
      y: Math.round(current.y + (TITLEBAR_HEIGHT + (h - TITLEBAR_HEIGHT) / 2) / current.zoom - 90)
    })
    setSelection([note.id])
    setSelectedGroup(null)
    setEditingId(note.id)
  }, [])

  const deleteSelected = useCallback(async () => {
    if (selectedGroup) {
      await window.jot.board.deleteGroup(selectedGroup, true)
      setSelectedGroup(null)
      toast('已解散分组')
      return
    }
    if (selection.length === 0) return
    await window.jot.board.deleteNotes(selection)
    setSelection([])
    toast(`已删除 ${selection.length} 张卡片`)
  }, [selectedGroup, selection, toast])

  const applyColor = useCallback(
    async (color: CardColor) => {
      if (selectedGroup) {
        await window.jot.board.updateGroup(selectedGroup, { color })
        return
      }
      await Promise.all(selection.map((id) => window.jot.board.updateNote(id, { color })))
    },
    [selectedGroup, selection]
  )

  const togglePin = useCallback(async () => {
    const targets = notes.filter((note) => selection.includes(note.id))
    if (targets.length === 0) return
    const nextPinned = !targets.every((note) => note.pinned)
    await Promise.all(targets.map((note) => window.jot.board.updateNote(note.id, { pinned: nextPinned })))
    toast(nextPinned ? '已收藏' : '已取消收藏')
  }, [notes, selection, toast])

  const applyTag = useCallback(
    async (nextTags: string[]) => {
      if (!tagEditor) return
      await Promise.all(tagEditor.ids.map((id) => window.jot.board.updateNote(id, { tags: nextTags })))
      setTagEditor({ ...tagEditor, selected: nextTags })
    },
    [tagEditor]
  )

  const createGroupFromSelection = useCallback(async () => {
    const members = notes.filter((note) => selection.includes(note.id))
    if (members.length < 2) return
    let minX = Number.POSITIVE_INFINITY
    let minY = Number.POSITIVE_INFINITY
    let maxX = Number.NEGATIVE_INFINITY
    let maxY = Number.NEGATIVE_INFINITY
    for (const member of members) {
      const height = heightsRef.current.get(member.id) ?? 120
      minX = Math.min(minX, member.x)
      minY = Math.min(minY, member.y)
      maxX = Math.max(maxX, member.x + member.width)
      maxY = Math.max(maxY, member.y + height)
    }
    const group = await window.jot.board.createGroup({
      title: `分组 ${groups.length + 1}`,
      x: minX,
      y: minY,
      w: maxX - minX,
      h: maxY - minY,
      memberIds: selection
    })
    setSelection([])
    setSelectedGroup(group.id)
    toast('已创建分组')
  }, [groups.length, notes, selection, toast])

  const toggleGroupCollapse = useCallback(async () => {
    if (!selectedGroup) return
    const group = groups.find((item) => item.id === selectedGroup)
    if (!group) return
    await window.jot.board.updateGroup(selectedGroup, { collapsed: !group.collapsed })
  }, [groups, selectedGroup])

  const updateNoteWidth = useCallback(async (id: string, width: CardWidth) => {
    await window.jot.board.updateNote(id, { width })
  }, [])

  /* ---------------------------- 右键菜单 ---------------------------- */

  const openCardMenu = useCallback(
    (event: React.MouseEvent, id: string) => {
      const note = notes.find((item) => item.id === id)
      if (!note) return
      if (!selection.includes(id)) setSelection([id])
      const entries: MenuEntry[] = [
        { kind: 'item', label: '编辑', onSelect: () => setEditingId(id) },
        {
          kind: 'item',
          label: '复制文字',
          onSelect: () => {
            void navigator.clipboard.writeText(note.text)
            toast('已复制')
          }
        },
        { kind: 'separator' },
        { kind: 'label', text: '卡片宽度' },
        { kind: 'item', label: '窄', hint: '240', onSelect: () => void updateNoteWidth(id, 240) },
        { kind: 'item', label: '标准', hint: '320', onSelect: () => void updateNoteWidth(id, 320) },
        { kind: 'item', label: '宽', hint: '480', onSelect: () => void updateNoteWidth(id, 480) },
        { kind: 'separator' },
        { kind: 'label', text: '颜色' },
        { kind: 'colors', active: note.color, onSelect: (color) => void window.jot.board.updateNote(id, { color }) },
        { kind: 'separator' },
        { kind: 'item', label: '删除卡片', danger: true, onSelect: () => void window.jot.board.deleteNotes([id]) }
      ]
      setMenu({ x: event.clientX, y: event.clientY, entries })
    },
    [notes, selection, toast, updateNoteWidth]
  )

  const openGroupMenu = useCallback(
    (event: React.MouseEvent, id: string) => {
      const group = groups.find((item) => item.id === id)
      if (!group) return
      setSelectedGroup(id)
      setSelection([])
      const entries: MenuEntry[] = [
        {
          kind: 'item',
          label: '重命名分组',
          onSelect: () =>
            setPrompt({
              x: event.clientX,
              y: event.clientY,
              title: '分组名称',
              initial: group.title,
              onSubmit: (value) => void window.jot.board.updateGroup(id, { title: value })
            })
        },
        {
          kind: 'item',
          label: group.collapsed ? '展开分组' : '折叠分组',
          onSelect: () => void window.jot.board.updateGroup(id, { collapsed: !group.collapsed })
        },
        { kind: 'label', text: '颜色' },
        { kind: 'colors', active: group.color, onSelect: (color) => void window.jot.board.updateGroup(id, { color }) },
        { kind: 'separator' },
        {
          kind: 'item',
          label: '解散分组（保留卡片）',
          onSelect: () => void window.jot.board.deleteGroup(id, true)
        },
        {
          kind: 'item',
          label: '删除组内卡片',
          danger: true,
          onSelect: () => void window.jot.board.deleteGroup(id, false)
        }
      ]
      setMenu({ x: event.clientX, y: event.clientY, entries })
    },
    [groups]
  )

  /* ---------------------------- 全局键盘 ---------------------------- */

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent): void => {
      const target = event.target as HTMLElement | null
      const typing = target ? ['INPUT', 'TEXTAREA'].includes(target.tagName) || target.isContentEditable : false

      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'f') {
        event.preventDefault()
        searchRef.current?.focus()
        searchRef.current?.select()
        return
      }
      if (typing) return
      if (event.key === 'Escape') {
        setSelection([])
        setSelectedGroup(null)
        setEditingId(null)
        setQuery('')
        setPinnedOnly(false)
        setFilterTags([])
      }
      if (event.key === 'Delete' && selection.length > 0) {
        event.preventDefault()
        void deleteSelected()
      }
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [deleteSelected, selection.length])

  /* ------------------------------ 渲染 ------------------------------ */

  const selectionNotes = notes.filter((note) => selection.includes(note.id))
  const allPinned = selectionNotes.length > 0 && selectionNotes.every((note) => note.pinned)
  const selectedGroupData = selectedGroup ? groups.find((item) => item.id === selectedGroup) : null
  const zoomPercent = Math.round(camera.zoom * 100)

  const runSearchFirst = (): void => {
    if (matchOrder.length > 0) flyToNote(matchOrder[0])
  }

  return (
    <div className="app">
      <header className="titlebar">
        <div className="brand">
          <div className="brand-mark">J</div>
          <div className="brand-name">Jot</div>
        </div>

        <label className="search">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <circle cx="11" cy="11" r="6.5" />
            <path d="M16 16l4.5 4.5" strokeLinecap="round" />
          </svg>
          <input
            ref={searchRef}
            value={query}
            placeholder="搜索卡片…"
            onChange={(event) => setQuery(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === 'Enter') runSearchFirst()
              if (event.key === 'Escape') {
                setQuery('')
                setPinsearchFocus()
              }
            }}
          />
          {query && (
            <button className="search-clear" onClick={() => setQuery('')} aria-label="清空搜索">
              <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2">
                <path d="M6 6l12 12M18 6L6 18" strokeLinecap="round" />
              </svg>
            </button>
          )}
        </label>

        <div className="toolbar-group">
          <button className="glass-btn" data-active={pinnedOnly} onClick={() => setPinnedOnly((value) => !value)}>
            <svg width="13" height="13" viewBox="0 0 24 24" fill={pinnedOnly ? 'currentColor' : 'none'} stroke="currentColor" strokeWidth="1.7">
              <path d="M12 3l2.6 5.7 6.2.7-4.6 4.2 1.2 6.1L12 16.8 6.6 19.7l1.2-6.1L3.2 9.4l6.2-.7z" strokeLinejoin="round" />
            </svg>
            收藏
          </button>
          <button
            className="glass-btn"
            data-active={filterTags.length > 0}
            onClick={(event) => {
              const rect = event.currentTarget.getBoundingClientRect()
              setTagFilterAnchor({ x: rect.left, y: rect.bottom + 6 })
            }}
          >
            <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7">
              <path d="M4 6h9l7 6-7 6H4z" strokeLinejoin="round" />
            </svg>
            标签{filterTags.length > 0 ? ` · ${filterTags.length}` : ''}
          </button>
          {(matchIds !== null || pinnedOnly) && (
            <button className="glass-btn" onClick={() => { setQuery(''); setPinnedOnly(false); setFilterTags([]) }}>
              清除筛选
            </button>
          )}
        </div>

        <div className="titlebar-drag" onDoubleClick={() => void window.jot.window.action('maximize')} />

        <button className="primary-btn" onClick={() => void createNote()}>
          <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <path d="M12 5v14M5 12h14" strokeLinecap="round" />
          </svg>
          新建
        </button>

        <div className="window-controls">
          <button onClick={() => void window.jot.window.action('minimize')} aria-label="最小化">
            <svg width="11" height="11" viewBox="0 0 12 12" stroke="currentColor" strokeWidth="1.2">
              <path d="M2 6h8" strokeLinecap="round" />
            </svg>
          </button>
          <button onClick={() => void window.jot.window.action('maximize')} aria-label="最大化">
            {maximized ? (
              <svg width="11" height="11" viewBox="0 0 12 12" fill="none" stroke="currentColor" strokeWidth="1.2">
                <rect x="2.5" y="3.5" width="6" height="6" rx="1" />
                <path d="M4 3.5V2.5h5.5V8" strokeLinecap="round" />
              </svg>
            ) : (
              <svg width="11" height="11" viewBox="0 0 12 12" fill="none" stroke="currentColor" strokeWidth="1.2">
                <rect x="2.5" y="2.5" width="7" height="7" rx="1.2" />
              </svg>
            )}
          </button>
          <button className="close" onClick={() => void window.jot.window.action('close')} aria-label="关闭">
            <svg width="11" height="11" viewBox="0 0 12 12" stroke="currentColor" strokeWidth="1.2">
              <path d="M2.5 2.5l7 7M9.5 2.5l-7 7" strokeLinecap="round" />
            </svg>
          </button>
        </div>
      </header>

      <Canvas
        notes={notes}
        groups={groups}
        groupRects={groupRects}
        camera={camera}
        selection={selection}
        selectedGroup={selectedGroup}
        editingId={editingId}
        matchIds={matchIds}
        heightsRef={heightsRef}
        onCamera={applyCamera}
        onInterrupt={stopAnimation}
        onSelectionChange={setSelection}
        onSelectGroup={setSelectedGroup}
        onMoveNotes={(items) => void window.jot.board.moveNotes(items)}
        onMoveGroup={(groupId, dx, dy) => void window.jot.board.moveGroup(groupId, dx, dy)}
        onEdit={setEditingId}
        onCommitText={commitText}
        onMeasure={onMeasure}
        onContextMenuCard={openCardMenu}
        onContextMenuGroup={openGroupMenu}
        onOpenImage={setLightbox}
        onBackgroundClick={() => undefined}
      />

      <div className="dock zoom-dock">
        <button className="dock-btn" onClick={() => zoomBy(1 / 1.25)} aria-label="缩小">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <path d="M5 12h14" strokeLinecap="round" />
          </svg>
        </button>
        <span className="zoom-value">{zoomPercent}%</span>
        <button className="dock-btn" onClick={() => zoomBy(1.25)} aria-label="放大">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <path d="M12 5v14M5 12h14" strokeLinecap="round" />
          </svg>
        </button>
        <div className="divider" />
        <button className="dock-btn" onClick={fitAll} title="全览">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8">
            <path d="M4 9V5h4M20 9V5h-4M4 15v4h4M20 15v4h-4" strokeLinecap="round" />
          </svg>
          全览
        </button>
      </div>

      {(selection.length > 0 || selectedGroupData) && (
        <div className="dock selection-dock">
          <div className="swatches">
            {(['none', 'sand', 'rose', 'sky', 'sage', 'lilac', 'slate'] as CardColor[]).map((color) => (
              <button
                key={color}
                className="swatch"
                data-color={color}
                data-active={(selectedGroupData?.color ?? selectionNotes[0]?.color) === color}
                onClick={() => void applyColor(color)}
                aria-label={`颜色 ${color}`}
              />
            ))}
          </div>
          <div className="divider" />
          {selectedGroupData ? (
            <>
              <button className="dock-btn" onClick={() => void toggleGroupCollapse()}>
                {selectedGroupData.collapsed ? '展开' : '折叠'}
              </button>
              <button
                className="dock-btn"
                onClick={(event) => {
                  const rect = event.currentTarget.getBoundingClientRect()
                  setPrompt({
                    x: rect.left,
                    y: rect.top - 72,
                    title: '分组名称',
                    initial: selectedGroupData.title,
                    onSubmit: (value) => void window.jot.board.updateGroup(selectedGroupData.id, { title: value })
                  })
                }}
              >
                重命名
              </button>
              <button className="dock-btn" onClick={() => void window.jot.board.deleteGroup(selectedGroupData.id, true)}>
                解散
              </button>
              <button className="dock-btn danger" onClick={() => void deleteSelected()}>
                删除组内卡片
              </button>
            </>
          ) : (
            <>
              <button
                className="dock-btn"
                onClick={(event) => {
                  const rect = event.currentTarget.getBoundingClientRect()
                  setTagEditor({
                    x: rect.left,
                    y: rect.top - 168,
                    ids: selection,
                    selected: selectionNotes[0]?.tags ?? []
                  })
                }}
              >
                标签
              </button>
              <button className="dock-btn" data-active={allPinned} onClick={() => void togglePin()}>
                {allPinned ? '取消收藏' : '收藏'}
              </button>
              {selection.length >= 2 && (
                <button className="dock-btn" onClick={() => void createGroupFromSelection()}>
                  成组
                </button>
              )}
              {selection.length === 1 && (
                <button className="dock-btn" onClick={() => setEditingId(selection[0])}>
                  编辑
                </button>
              )}
              <button className="dock-btn danger" onClick={() => void deleteSelected()}>
                删除
              </button>
            </>
          )}
        </div>
      )}

      <button
        className="status-pill"
        onClick={() => setSettingsOpen(true)}
        title={settings ? `备份：${backupState.status}` : ''}
      >
        <span className="status-dot" data-status={backupState.status} />
        {backupState.status === 'ok'
          ? '已备份'
          : backupState.status === 'syncing'
            ? '备份中'
            : backupState.status === 'error'
              ? '备份失败'
              : settings?.cos.hasCredential
                ? '待备份'
                : '未配置备份'}
      </button>

      <Toasts items={toasts} />
      {lightbox && <Lightbox imageId={lightbox} onClose={() => setLightbox(null)} />}

      {menu && <ContextMenu x={menu.x} y={menu.y} entries={menu.entries} onClose={() => setMenu(null)} />}

      {tagEditor && (
        <TagPopover
          x={tagEditor.x}
          y={tagEditor.y}
          allTags={allTags}
          selected={tagEditor.selected}
          onChange={(tags) => void applyTag(tags)}
          onClose={() => setTagEditor(null)}
        />
      )}

      {tagFilterAnchor && (
        <TagPopover
          x={tagFilterAnchor.x}
          y={tagFilterAnchor.y}
          allTags={allTags}
          selected={filterTags}
          onChange={setFilterTags}
          onClose={() => setTagFilterAnchor(null)}
        />
      )}

      {prompt && (
        <PromptPopover
          x={prompt.x}
          y={prompt.y}
          title={prompt.title}
          initial={prompt.initial}
          onSubmit={prompt.onSubmit}
          onClose={() => setPrompt(null)}
        />
      )}

      {settingsOpen && settings && (
        <SettingsDialog
          settings={settings}
          backupState={backupState}
          onClose={() => setSettingsOpen(false)}
          onSettingsChanged={setSettings}
        />
      )}

      <div style={{ display: 'none' }}>{formatAccelerator(settings?.hotkey ?? '')}</div>
    </div>
  )
}

function setPinsearchFocus(): void {
  /* 搜索框 Esc 后保持焦点，避免再次点击 */
  requestAnimationFrame(() => {
    const input = document.querySelector<HTMLInputElement>('.search input')
    input?.focus()
  })
}
