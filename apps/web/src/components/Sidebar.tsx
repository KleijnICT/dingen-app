import { newArea, newProject, orderBetween, type Project, views } from '@dingen/core'
import { useDraggable, useDroppable } from '@dnd-kit/core'
import { ListPlus, ListRestart, Settings } from 'lucide-react'
import { type PointerEvent, type ReactElement, type ReactNode, useRef, useState } from 'react'
import type { DragData, DropData } from '../dnd.js'
import { useT } from '../i18n/index.js'
import { countFor, LISTS, type ListId } from '../lists.js'
import {
  clampSidebar,
  setSidebarWidth,
  toggleAreaCollapsed,
  useCollapsedAreas,
  useSidebarWidth,
} from '../prefs.js'
import { showReviewDot } from '../reviewFlow.js'
import { areaPath, navigate, projectPath } from '../router.js'
import { useEngine, useWorkspace } from '../store/context.js'
import type { SyncStatus } from '../store/engine.js'
import { AreaGlyph } from './AreaIcons.js'
import {
  AnytimeIcon,
  CalendarIcon,
  ChevronIcon,
  InboxIcon,
  LogbookIcon,
  ProgressCircle,
  SomedayIcon,
  TodayIcon,
} from './Icons.js'
import { useDismiss } from './Menu.js'
import { useReviews } from './useReviews.js'

const APP_VERSION_LABEL = `Dingen ${__DINGEN_VERSION__}${__DINGEN_BUILD__ ? ` · ${__DINGEN_BUILD__}` : ''}`

interface Props {
  path: string
  status: SyncStatus
  onOpenSettings: () => void
}

const ICONS: Record<ListId, (p: { className?: string }) => ReactElement> = {
  inbox: InboxIcon,
  today: TodayIcon,
  upcoming: CalendarIcon,
  anytime: AnytimeIcon,
  someday: SomedayIcon,
  logbook: LogbookIcon,
}

export function Sidebar({ path, status, onOpenSettings }: Props) {
  const t = useT()
  const engine = useEngine()
  const ws = useWorkspace()
  const reviewDot = showReviewDot(useReviews(), ws.today)
  const [adding, setAdding] = useState(false)
  const statusText = t(`sync.${status}`)
  const collapsed = useCollapsedAreas()
  const width = useSidebarWidth()
  const addRoot = useRef<HTMLDivElement>(null)
  const addButton = useRef<HTMLButtonElement>(null)
  const closeAdd = useRef(() => setAdding(false)).current
  useDismiss(adding, closeAdd, addRoot, addButton)

  // Dragging the right edge resizes the sidebar; the pointer is captured so
  // the drag keeps working when it leaves the thin handle.
  function startResize(e: PointerEvent<HTMLDivElement>) {
    e.preventDefault()
    e.currentTarget.setPointerCapture(e.pointerId)
    const startX = e.clientX
    const startWidth = width
    const handle = e.currentTarget
    const move = (ev: globalThis.PointerEvent) =>
      setSidebarWidth(clampSidebar(startWidth + ev.clientX - startX))
    const stop = () => {
      handle.removeEventListener('pointermove', move)
      handle.removeEventListener('pointerup', stop)
      handle.removeEventListener('pointercancel', stop)
    }
    handle.addEventListener('pointermove', move)
    handle.addEventListener('pointerup', stop)
    handle.addEventListener('pointercancel', stop)
  }

  function addProject(areaId: string | null) {
    const last = views.projectsOf(ws.projects, areaId).at(-1)
    const project = newProject({
      title: '',
      areaId,
      order: orderBetween(last?.order ?? null, null),
    })
    engine.create('project', project)
    setAdding(false)
    navigate(projectPath(project.id))
  }

  function addArea() {
    const last = views.openAreas(ws.areas).at(-1)
    const area = newArea({ title: '', order: orderBetween(last?.order ?? null, null) })
    engine.create('area', area)
    setAdding(false)
    navigate(areaPath(area.id))
  }

  const projectItem = (p: Project) => (
    <NavLink
      href={projectPath(p.id)}
      className="project"
      active={path === projectPath(p.id)}
      drop={{ type: 'project', project: p }}
      drag={{ type: 'project', project: p }}
    >
      <ProgressCircle value={views.progress(p.id, ws.tasks)} className="nav-icon" />
      <span className="nav-title">{p.title || <em>{t('project.untitled')}</em>}</span>
    </NavLink>
  )

  return (
    <nav className="sidebar" aria-label={t('nav.lists')}>
      <div className="sidebar-scroll">
        <ul className="nav">
          {LISTS.map((list) => {
            const Icon = ICONS[list.id]
            const count = countFor(list.id, ws)
            const item = (
              <li key={list.id}>
                <NavLink
                  href={list.path}
                  className={list.id}
                  active={path === list.path}
                  drop={{ type: 'list', listId: list.id }}
                >
                  <Icon className="nav-icon" />
                  <span className="nav-title">{t(list.titleKey)}</span>
                  {count !== null && count > 0 && <span className="nav-count">{count}</span>}
                </NavLink>
              </li>
            )
            // --- review: "Review" sits between Someday and Logbook ---
            if (list.id !== 'logbook') return item
            return [
              <li key="review">
                <NavLink href="/review" className="review" active={path.startsWith('/review')}>
                  <ListRestart
                    size={18}
                    strokeWidth={1.8}
                    className="nav-icon"
                    aria-hidden="true"
                  />
                  <span className="nav-title">{t('review.nav')}</span>
                  {reviewDot && (
                    <span className="review-dot" role="img" aria-label={t('review.nav.ready')} />
                  )}
                </NavLink>
              </li>,
              item,
            ]
          })}
        </ul>
        <ul className="nav tree">
          {views.projectsOf(ws.projects, null).map((p) => (
            <li key={p.id}>{projectItem(p)}</li>
          ))}
          {views.openAreas(ws.areas).map((area) => {
            const projects = views.projectsOf(ws.projects, area.id)
            const closed = collapsed.has(area.id)
            return (
              <li key={area.id} className="area-group">
                <div className="area-row">
                  <NavLink
                    href={areaPath(area.id)}
                    className="area"
                    active={path === areaPath(area.id)}
                    drop={{ type: 'area', area }}
                    drag={{ type: 'area', area }}
                  >
                    <AreaGlyph icon={area.icon} color={area.color} className="nav-icon" />
                    <span className="nav-title">{area.title || <em>{t('area.untitled')}</em>}</span>
                  </NavLink>
                  {projects.length > 0 && (
                    <button
                      type="button"
                      className={`area-toggle ${closed ? 'closed' : ''}`}
                      aria-expanded={!closed}
                      aria-label={t(closed ? 'nav.expand' : 'nav.collapse')}
                      title={t(closed ? 'nav.expand' : 'nav.collapse')}
                      onClick={() => toggleAreaCollapsed(area.id)}
                    >
                      <ChevronIcon />
                    </button>
                  )}
                </div>
                {!closed && (
                  <ul className="nav">
                    {projects.map((p) => (
                      <li key={p.id}>{projectItem(p)}</li>
                    ))}
                  </ul>
                )}
              </li>
            )
          })}
        </ul>
      </div>
      <div className="sidebar-foot">
        <div className="foot-row">
          <div className="new-list" ref={addRoot}>
            <button
              type="button"
              ref={addButton}
              className="foot-button new-list-button"
              aria-haspopup="menu"
              aria-expanded={adding}
              onClick={() => setAdding((a) => !a)}
            >
              <ListPlus size={16} strokeWidth={1.8} aria-hidden="true" />
              <span>{t('nav.newList')}</span>
            </button>
            {adding && (
              <div className="popover menu new-list-menu" role="menu">
                <button
                  type="button"
                  role="menuitem"
                  className="menu-item"
                  onClick={() => addProject(null)}
                >
                  <ProgressCircle value={0} size={16} />
                  <span>
                    <strong>{t('nav.newProject')}</strong>
                    <small>{t('nav.newProject.hint')}</small>
                  </span>
                </button>
                <button type="button" role="menuitem" className="menu-item" onClick={addArea}>
                  <AreaGlyph icon={null} color={null} size={16} />
                  <span>
                    <strong>{t('nav.newArea')}</strong>
                    <small>{t('nav.newArea.hint')}</small>
                  </span>
                </button>
              </div>
            )}
          </div>
          <button
            type="button"
            className="foot-button settings-button"
            aria-label={t('settings.title')}
            title={t('settings.title')}
            onClick={onOpenSettings}
          >
            <Settings size={16} strokeWidth={1.8} aria-hidden="true" />
          </button>
        </div>
        <p className={`sync-status ${status}`} title={`${statusText} · ${APP_VERSION_LABEL}`}>
          <span className="dot" />
          <span className="sync-text">{statusText}</span>
          <span className="app-version">{APP_VERSION_LABEL}</span>
        </p>
      </div>
      {/* biome-ignore lint/a11y/useSemanticElements: an <hr> cannot be dragged */}
      <div
        className="sidebar-resize"
        role="separator"
        aria-orientation="vertical"
        aria-label={t('nav.resize')}
        aria-valuenow={width}
        tabIndex={-1}
        onPointerDown={startResize}
        onDoubleClick={() => setSidebarWidth(null)}
      />
    </nav>
  )
}

interface NavLinkProps {
  href: string
  className: string
  active: boolean
  title?: string | undefined
  drop?: DropData | undefined
  drag?: DragData | undefined
  children: ReactNode
}

/** A sidebar link that can receive drops and, for projects and areas, be dragged itself. */
function NavLink({ href, className, active, title, drop, drag, children }: NavLinkProps) {
  const droppable = useDroppable({ id: `nav:${href}`, data: drop ?? {}, disabled: !drop })
  const draggable = useDraggable({ id: `drag:${href}`, data: drag ?? {}, disabled: !drag })
  return (
    <a
      ref={(el) => {
        droppable.setNodeRef(el)
        draggable.setNodeRef(el)
      }}
      href={href}
      className={`nav-item ${className} ${active ? 'active' : ''} ${
        droppable.isOver ? 'drop-over' : ''
      } ${draggable.isDragging ? 'dragging' : ''}`}
      title={title}
      onClick={(e) => {
        e.preventDefault()
        navigate(href)
      }}
      {...draggable.listeners}
    >
      {children}
    </a>
  )
}
