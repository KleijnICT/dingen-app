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
import { type CSSProperties, useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { User } from './api.js'
import { useCalendarFeed } from './calendar.js'
import { AreaPage } from './components/AreaPage.js'
import { ListPage } from './components/ListPage.js'
import { LogbookPage } from './components/LogbookPage.js'
import { ProjectPage } from './components/ProjectPage.js'
import { ResizeHandle } from './components/ResizeHandle.js'
import { ReviewPage } from './components/ReviewPage.js'
import { Search } from './components/Search.js'
import { Sidebar } from './components/Sidebar.js'
import { MenuButton, SidebarDrawer, useNarrow } from './components/SidebarDrawer.js'
import { SideSlot } from './components/SideSlot.js'
import { PanelSlot } from './components/TaskPanel.js'
import { ShellActions, ToolbarSlot } from './components/Toolbar.js'
import { UpdateNotice } from './components/UpdateNotice.js'
import { type DragData, handleDragEnd } from './dnd.js'
import { focusActive, focusKeyAction } from './focus.js'
import { useT } from './i18n/index.js'
import { LISTS } from './lists.js'
import { setFocusMode, setWidth, useFocusMode, usePanelWidth, useSidebarWidth } from './prefs.js'
import { SIDEBAR_LIMITS } from './resize.js'
import { navigate, parseRoute, usePath } from './router.js'
import { Settings } from './Settings.js'
import { useBuildWorkspace, useEngine, WorkspaceContext } from './store/context.js'
import { initTodaySeen, refreshTodaySeen } from './todaySeen.js'

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
  useState(() => initTodaySeen(user))
  useEffect(() => {
    const onVisible = () => {
      if (document.visibilityState === 'visible') void refreshTodaySeen()
    }
    document.addEventListener('visibilitychange', onVisible)
    return () => document.removeEventListener('visibilitychange', onVisible)
  }, [])
  const t = useT()
  const sidebarWidth = useSidebarWidth()
  const panelWidth = usePanelWidth()
  const focusPref = useFocusMode()
  const route = parseRoute(path)
  const [dragging, setDragging] = useState<DragData | null>(null)
  const [settingsOpen, setSettingsOpen] = useState(route.kind === 'account')
  const [searchOpen, setSearchOpen] = useState(false)
  const [toolbar, setToolbar] = useState<HTMLDivElement | null>(null)
  const [panelSlot, setPanelSlot] = useState<HTMLDivElement | null>(null)
  const [sideSlot, setSideSlot] = useState<HTMLDivElement | null>(null)
  const actions = useMemo(() => ({ openSearch: () => setSearchOpen(true) }), [])
  const closeSettings = useCallback(() => setSettingsOpen(false), [])
  const closeSearch = useCallback(() => setSearchOpen(false), [])
  const narrow = useNarrow()
  const [drawerOpen, setDrawerOpen] = useState(false)
  const menuButton = useRef<HTMLButtonElement>(null)
  const openDrawer = useCallback(() => setDrawerOpen(true), [])
  const closeDrawer = useCallback(() => setDrawerOpen(false), [])
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

  // Choosing a list closes the drawer; so does growing past phone width.
  // biome-ignore lint/correctness/useExhaustiveDependencies: path is the trigger
  useEffect(() => setDrawerOpen(false), [path, narrow])

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
  const oldReview = route.kind === 'oldReview'
  useEffect(() => {
    if (oldReview) navigate('/review')
  }, [oldReview])

  const onToday = list?.id === 'today'
  const focus = focusActive(focusPref, list?.id)
  useEffect(() => {
    function onFocusKey(e: KeyboardEvent) {
      const target = e.target instanceof HTMLElement ? e.target : null
      const panel = target?.closest('.task-panel') ?? null
      const popup = target?.closest('[role="dialog"], [role="menu"]')
      const action = focusKeyAction({
        key: e.key,
        modified: e.metaKey || e.ctrlKey || e.altKey,
        // The task list's own handler runs first and marks the keys it used.
        handled:
          e.defaultPrevented ||
          Boolean(document.querySelector('[role="dialog"][aria-modal="true"]')),
        typing: Boolean(target?.closest('input, textarea, select, [contenteditable="true"]')),
        inPopup: Boolean(popup && popup !== panel),
        inPanel: Boolean(panel),
        onToday,
        on: focus,
      })
      if (!action) return
      e.preventDefault()
      setFocusMode(action === 'toggle' ? !focus : false)
    }
    window.addEventListener('keydown', onFocusKey)
    return () => window.removeEventListener('keydown', onFocusKey)
  }, [onToday, focus])

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
  if (list?.id === 'logbook') {
    page = <LogbookPage key={list.id} list={list} user={user} focusSignal={focusSignal} />
  } else if (list) page = <ListPage key={list.id} list={list} focusSignal={focusSignal} />
  else if (project) {
    page = <ProjectPage key={project.id} project={project} focusSignal={focusSignal} />
  } else if (area) page = <AreaPage key={area.id} area={area} focusSignal={focusSignal} />
  else if (route.kind === 'review') {
    page = <ReviewPage focusSignal={focusSignal} />
  }

  const sidebar = (
    <Sidebar
      path={path}
      status={engine.status}
      onOpenSettings={() => {
        setDrawerOpen(false)
        setSettingsOpen(true)
      }}
    />
  )

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
          <div
            className={focus ? 'app focus-mode' : 'app'}
            style={
              {
                '--sidebar-width': `${sidebarWidth}px`,
                '--panel-width': `${panelWidth}px`,
              } as CSSProperties
            }
          >
            {narrow ? (
              <SidebarDrawer
                open={drawerOpen}
                onOpen={openDrawer}
                onClose={closeDrawer}
                returnFocus={menuButton}
              >
                {sidebar}
              </SidebarDrawer>
            ) : (
              sidebar
            )}
            {!narrow && !focus && (
              <ResizeHandle
                className="sidebar-resize"
                label={t('nav.resize')}
                width={sidebarWidth}
                limits={SIDEBAR_LIMITS}
                edge="right"
                room={sidebarRoom}
                onChange={setSidebarWidth}
              />
            )}
            <main className="content-pane">
              {narrow && (
                <div className="mobile-bar">
                  <MenuButton open={drawerOpen} onOpen={openDrawer} buttonRef={menuButton} />
                </div>
              )}
              <div className="content-body">
                <div className="side-slot" ref={setSideSlot} />
                <div className="content">
                  <ToolbarSlot.Provider value={toolbar}>
                    <PanelSlot.Provider value={panelSlot}>
                      <SideSlot.Provider value={sideSlot}>{page}</SideSlot.Provider>
                    </PanelSlot.Provider>
                  </ToolbarSlot.Provider>
                </div>
                <div className="panel-slot" ref={setPanelSlot} />
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

/** Room for the sidebar: the window, less a task panel open beside the list. */
function sidebarRoom(): number {
  const panel = document.querySelector('.task-panel.side')
  return window.innerWidth - (panel?.getBoundingClientRect().width ?? 0)
}

function setSidebarWidth(width: number | null): void {
  setWidth('sidebar', width)
}

function ghostTitle(d: DragData): string {
  if (d.type === 'task') return d.task.title
  if (d.type === 'project') return d.project.title
  if (d.type === 'checklistItem') return d.item.title
  return d.area.title
}
