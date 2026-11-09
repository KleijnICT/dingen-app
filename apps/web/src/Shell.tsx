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
import { useCallback, useEffect, useState } from 'react'
import { Account } from './Account.js'
import type { User } from './api.js'
import { AreaPage } from './components/AreaPage.js'
import { ListPage } from './components/ListPage.js'
import { ProjectPage } from './components/ProjectPage.js'
import { Sidebar } from './components/Sidebar.js'
import { type DragData, handleDragEnd } from './dnd.js'
import { LISTS } from './lists.js'
import { navigate, parseRoute, usePath } from './router.js'
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
  const route = parseRoute(path)
  const [dragging, setDragging] = useState<DragData | null>(null)
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
  const redirect = missing && engine.ready
  useEffect(() => {
    if (redirect) navigate('/today')
  }, [redirect])

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      const target = e.target as HTMLElement | null
      const typing =
        target &&
        (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.tagName === 'SELECT')
      if (e.key === 'n' && !typing && !e.metaKey && !e.ctrlKey && !e.altKey) {
        e.preventDefault()
        setFocusSignal((n) => n + 1)
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
  else if (route.kind === 'account') page = <Account user={user} onSignedOut={onSignedOut} />

  return (
    <WorkspaceContext.Provider value={ws}>
      <DndContext
        sensors={sensors}
        collisionDetection={collision}
        onDragStart={onDragStart}
        onDragEnd={onDragEnd}
        onDragCancel={() => setDragging(null)}
      >
        <div className="app">
          <Sidebar path={path} status={engine.status} email={user.email} />
          <main className="content">{page}</main>
        </div>
        <DragOverlay dropAnimation={null}>
          {dragging && <div className="drag-ghost">{ghostTitle(dragging)}</div>}
        </DragOverlay>
      </DndContext>
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
