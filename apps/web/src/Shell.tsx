import { toCalendarDate } from '@dingen/core'
import {
  type CollisionDetection,
  DndContext,
  type DragEndEvent,
  DragOverlay,
  type DragStartEvent,
  PointerSensor,
  pointerWithin,
  rectIntersection,
  useSensor,
  useSensors,
} from '@dnd-kit/core'
import { type CSSProperties, useCallback, useEffect, useMemo, useState } from 'react'
import type { User } from './api.js'
import { useCalendarFeed } from './calendar.js'
import { AreaPage } from './components/AreaPage.js'
import { ListPage } from './components/ListPage.js'
import { ProjectPage } from './components/ProjectPage.js'
import { Search } from './components/Search.js'
import { Sidebar } from './components/Sidebar.js'
import { ShellActions, ToolbarSlot } from './components/Toolbar.js'
import { UpdateNotice } from './components/UpdateNotice.js'
import { type DragData, handleDragEnd } from './dnd.js'
import { LISTS } from './lists.js'
import { useSidebarWidth } from './prefs.js'
import { navigate, parseRoute, usePath } from './router.js'
import { Settings } from './Settings.js'
import { useBuildWorkspace, useEngine, WorkspaceContext } from './store/context.js'

interface Props {
  user: User
  onSignedOut: () => void
}

/** The window after signing in: sidebar plus the chosen list, project or area. */
export function Shell({ user, onSignedOut }: Props) {
  const engine = useEngine()
  const path = usePath()
  const [today, setToday] = useState(toCalendarDate())
  const [focusSignal, setFocusSignal] = useState(0)
  const ws = useBuildWorkspace(today)
  useCalendarFeed(user.id, today)
  const sidebarWidth = useSidebarWidth()
  const route = parseRoute(path)
  const [dragging, setDragging] = useState<DragData | null>(null)
  const [settingsOpen, setSettingsOpen] = useState(route.kind === 'account')
  const [searchOpen, setSearchOpen] = useState(false)
  const [toolbar, setToolbar] = useState<HTMLDivElement | null>(null)
  const actions = useMemo(() => ({ openSearch: () => setSearchOpen(true) }), [])
  const closeSettings = useCallback(() => setSettingsOpen(false), [])
  const closeSearch = useCallback(() => setSearchOpen(false), [])
  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 6 } }))
  const onDragStart = useCallback((e: DragStartEvent) => {
    setDragging((e.active.data.current as DragData | undefined) ?? null)
  }, [])
  const onDragEnd = useCallback(
    (e: DragEndEvent) => {
      setDragging(null)
      handleDragEnd(engine, ws, e)
    },
    [engine, ws],
  )

  // The day changes at midnight; checking once a minute is enough.
  useEffect(() => {
    const timer = setInterval(() => setToday(toCalendarDate()), 60_000)
    return () => clearInterval(timer)
  }, [])

  const list = route.kind === 'list' ? LISTS.find((l) => l.path === route.path) : undefined
  const project = route.kind === 'project' ? ws.projectById.get(route.id) : undefined
  const area = route.kind === 'area' ? ws.areaById.get(route.id) : undefined
  const missing =
    (route.kind === 'list' && !list) ||
    (route.kind === 'project' && !project) ||
    (route.kind === 'area' && !area)

  // Only redirect once the replica is loaded; a project link must survive a fresh page load.
  const redirect = (missing && engine.ready) || route.kind === 'account'
  useEffect(() => {
    if (redirect) navigate('/today')
  }, [redirect])

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      const target = e.target as HTMLElement | null
      const typing =
        target &&
        (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.tagName === 'SELECT')
      const plain = !typing && !e.metaKey && !e.ctrlKey && !e.altKey
      if (!plain || document.querySelector('[role="dialog"][aria-modal="true"]')) return
      if (e.key === 'n') {
        e.preventDefault()
        setFocusSignal((n) => n + 1)
      }
      if (e.key === '/') {
        e.preventDefault()
        setSearchOpen(true)
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])

  let page: React.ReactNode = null
  if (list) page = <ListPage key={list.id} list={list} focusSignal={focusSignal} />
  else if (project) {
    page = <ProjectPage key={project.id} project={project} focusSignal={focusSignal} />
  } else if (area) page = <AreaPage key={area.id} area={area} focusSignal={focusSignal} />

  return (
    <WorkspaceContext.Provider value={ws}>
      <ShellActions.Provider value={actions}>
        <DndContext
          sensors={sensors}
          collisionDetection={collision}
          onDragStart={onDragStart}
          onDragEnd={onDragEnd}
          onDragCancel={() => setDragging(null)}
        >
          <div className="app" style={{ '--sidebar-width': `${sidebarWidth}px` } as CSSProperties}>
            <Sidebar
              path={path}
              status={engine.status}
              onOpenSettings={() => setSettingsOpen(true)}
            />
            <main className="content-pane">
              <div className="content">
                <ToolbarSlot.Provider value={toolbar}>{page}</ToolbarSlot.Provider>
              </div>
              <div className="toolbar" ref={setToolbar} />
            </main>
          </div>
          <DragOverlay dropAnimation={null}>
            {dragging && <div className="drag-ghost">{ghostTitle(dragging)}</div>}
          </DragOverlay>
        </DndContext>
        {settingsOpen && <Settings user={user} onSignedOut={onSignedOut} onClose={closeSettings} />}
        {searchOpen && <Search onClose={closeSearch} />}
        <UpdateNotice />
      </ShellActions.Provider>
    </WorkspaceContext.Provider>
  )
}

/** The element under the pointer wins; otherwise the nearest overlapping one. */
const collision: CollisionDetection = (args) => {
  const within = pointerWithin(args)
  const hits = within.length > 0 ? within : rectIntersection(args)
  // A row inside a group beats the group itself.
  const isGroup = (c: (typeof hits)[number]) =>
    (c.data?.droppableContainer?.data?.current as { type?: string } | undefined)?.type === 'group'
  return [...hits].sort((a, b) => Number(isGroup(a)) - Number(isGroup(b)))
}

function ghostTitle(d: DragData): string {
  if (d.type === 'task') return d.task.title
  if (d.type === 'project') return d.project.title
  if (d.type === 'checklistItem') return d.item.title
  return d.area.title
}
