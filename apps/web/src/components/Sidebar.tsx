import { newArea, newProject, orderBetween, type Project, views } from '@dingen/core'
import { useDraggable, useDroppable } from '@dnd-kit/core'
import {
  ListPlus,
  ListRestart,
  PanelLeftClose,
  PanelLeftOpen,
  Search,
  Settings,
} from 'lucide-react'
import { type ReactElement, type ReactNode, useContext, useRef, useState } from 'react'
import type { DragData, DropData } from '../dnd.js'
import { useT } from '../i18n/index.js'
import { countFor, LISTS, type ListId } from '../lists.js'
import { toggleAreaCollapsed, useCollapsedAreas } from '../prefs.js'
import { appHref, areaPath, navigate, parseRoute, projectPath } from '../router.js'
import { railAreaActive, railEntries } from '../sidebarFold.js'
import { useEngine, useWorkspace } from '../store/context.js'
import type { SyncStatus } from '../store/engine.js'
import { AREA_ICON_COMPONENTS, AreaGlyph, areaColorVar } from './AreaIcons.js'
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
import { Sheet, useDismiss } from './Menu.js'
import { PaneHeader } from './Pane.js'
import { ShellActions } from './Toolbar.js'

const APP_VERSION_LABEL = `Dingen ${__DINGEN_VERSION__}${__DINGEN_BUILD__ ? ` · ${__DINGEN_BUILD__}` : ''}`

interface Props {
  path: string
  status: SyncStatus
  /** Folded to a rail of icons. */
  rail?: boolean
  /** Folds or unfolds the sidebar; absent in the phone's drawer, which does not fold. */
  onToggleRail?: (() => void) | undefined
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

export function Sidebar({ path, status, rail = false, onToggleRail, onOpenSettings }: Props) {
  if (rail) {
    return <SidebarRail path={path} onToggleRail={onToggleRail} onOpenSettings={onOpenSettings} />
  }
  return (
    <FullSidebar
      path={path}
      status={status}
      onToggleRail={onToggleRail}
      onOpenSettings={onOpenSettings}
    />
  )
}

/** Folds the sidebar to the rail, or unfolds it; in the sidebar's head and on top of the rail. */
function FoldButton({ rail, onToggle }: { rail: boolean; onToggle: () => void }) {
  const t = useT()
  const label = t(rail ? 'sidebar.expand' : 'sidebar.collapse')
  const Icon = rail ? PanelLeftOpen : PanelLeftClose
  return (
    <button
      type="button"
      className="icon-button fold-button"
      aria-label={label}
      title={label}
      aria-expanded={!rail}
      onClick={onToggle}
    >
      <Icon size={16} aria-hidden="true" />
    </button>
  )
}

/** The search button in the head of the sidebar and the rail. */
function SearchButton() {
  const t = useT()
  const { openSearch } = useContext(ShellActions)
  return (
    <button
      type="button"
      className="icon-button"
      aria-label={t('toolbar.search')}
      title={t('toolbar.search')}
      onClick={openSearch}
    >
      <Search size={16} aria-hidden="true" />
    </button>
  )
}

function FullSidebar({ path, status, onToggleRail, onOpenSettings }: Omit<Props, 'rail'>) {
  const t = useT()
  const engine = useEngine()
  const ws = useWorkspace()
  const [adding, setAdding] = useState(false)
  const statusText = t(`sync.${status}`)
  const collapsed = useCollapsedAreas()
  const addRoot = useRef<HTMLDivElement>(null)
  const addButton = useRef<HTMLButtonElement>(null)
  const closeAdd = useRef(() => setAdding(false)).current
  useDismiss(adding, closeAdd, addRoot, addButton)

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
      <ProgressCircle
        value={views.progress(p.id, ws.tasks)}
        someday={views.isSomeday(p)}
        className="nav-icon"
      />
      <span className="nav-title">{p.title || <em>{t('project.untitled')}</em>}</span>
    </NavLink>
  )

  return (
    <nav className="sidebar" aria-label={t('nav.lists')}>
      <PaneHeader
        className="sidebar-head"
        title={t('sidebar.title')}
        actions={
          <>
            <SearchButton />
            {onToggleRail && <FoldButton rail={false} onToggle={onToggleRail} />}
          </>
        }
      />
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
                  <ListRestart size={18} className="nav-icon" aria-hidden="true" />
                  <span className="nav-title">{t('review.nav')}</span>
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
                      className={`icon-button small area-toggle ${closed ? 'closed' : ''}`}
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
              <ListPlus size={16} aria-hidden="true" />
              <span>{t('nav.newList')}</span>
            </button>
            {adding && (
              <Sheet
                label={t('nav.newList')}
                role="menu"
                side="above"
                className="menu new-list-menu"
                onClose={closeAdd}
              >
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
              </Sheet>
            )}
          </div>
          <button
            type="button"
            className="foot-button settings-button"
            aria-label={t('settings.title')}
            title={t('settings.title')}
            onClick={onOpenSettings}
          >
            <Settings size={16} aria-hidden="true" />
          </button>
        </div>
        <p className={`sync-status ${status}`} title={`${statusText} · ${APP_VERSION_LABEL}`}>
          <span className="dot" />
          <span className="sync-text">{statusText}</span>
          <span className="app-version">{APP_VERSION_LABEL}</span>
        </p>
      </div>
    </nav>
  )
}

/**
 * The sidebar folded to a column of icons: the lists, then the areas, each with its name as
 * tooltip and label. No projects; an area is lit on its projects' pages too. They still take
 * drops.
 */
function SidebarRail({
  path,
  onToggleRail,
  onOpenSettings,
}: {
  path: string
  onToggleRail?: (() => void) | undefined
  onOpenSettings: () => void
}) {
  const t = useT()
  const ws = useWorkspace()
  const route = parseRoute(path)
  const entries = railEntries(ws.areas)
  const lists = entries.filter((e) => e.kind !== 'area')
  const areas = entries.flatMap((e) => (e.kind === 'area' ? [e.area] : []))

  return (
    <nav className="sidebar rail" aria-label={t('nav.lists')}>
      <div className="pane-head rail-head">
        {onToggleRail ? <FoldButton rail onToggle={onToggleRail} /> : <SearchButton />}
      </div>
      <div className="rail-scroll">
        {onToggleRail && (
          <div className="rail-search">
            <SearchButton />
          </div>
        )}
        <ul className="nav rail-list">
          {lists.map((entry) => {
            if (entry.kind === 'review') {
              return (
                <li key="review">
                  <NavLink
                    href="/review"
                    className="review rail-item"
                    active={path.startsWith('/review')}
                    title={t('review.nav')}
                  >
                    <ListRestart size={18} className="nav-icon" aria-hidden="true" />
                  </NavLink>
                </li>
              )
            }
            if (entry.kind !== 'list') return null
            const list = LISTS.find((l) => l.id === entry.id)
            if (!list) return null
            const Icon = ICONS[list.id]
            return (
              <li key={list.id}>
                <NavLink
                  href={list.path}
                  className={`${list.id} rail-item`}
                  active={path === list.path}
                  title={t(list.titleKey)}
                  drop={{ type: 'list', listId: list.id }}
                >
                  <Icon className="nav-icon" />
                </NavLink>
              </li>
            )
          })}
        </ul>
        {areas.length > 0 && (
          <ul className="nav rail-list rail-tree">
            {areas.map((area) => (
              <li key={area.id}>
                <NavLink
                  href={areaPath(area.id)}
                  className="area rail-item"
                  active={railAreaActive(area.id, route, ws.projectById)}
                  title={area.title || t('area.untitled')}
                  drop={{ type: 'area', area }}
                >
                  <RailAreaIcon icon={area.icon} color={area.color} title={area.title} />
                </NavLink>
              </li>
            ))}
          </ul>
        )}
      </div>
      <div className="rail-foot">
        <button
          type="button"
          className="icon-button"
          aria-label={t('settings.title')}
          title={t('settings.title')}
          onClick={onOpenSettings}
        >
          <Settings size={16} aria-hidden="true" />
        </button>
      </div>
    </nav>
  )
}

/**
 * An area in the rail: its own icon, or, with the default icon, its first letter in its
 * colour, so areas without an icon of their own can still be told apart.
 */
function RailAreaIcon({
  icon,
  color,
  title,
}: {
  icon: string | null
  color: string | null
  title: string
}) {
  const known = icon !== null && icon in AREA_ICON_COMPONENTS
  if (known) return <AreaGlyph icon={icon} color={color} className="nav-icon" />
  const letter = [...title.trim()][0]?.toLocaleUpperCase() ?? ''
  if (!letter) return <AreaGlyph icon={null} color={color} className="nav-icon" />
  return (
    <span
      className="nav-icon rail-letter"
      style={{ color: areaColorVar(color) }}
      aria-hidden="true"
    >
      {letter}
    </span>
  )
}

interface NavLinkProps {
  href: string
  className: string
  active: boolean
  /** The name, as tooltip and label, where the link shows only an icon. */
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
      href={appHref(href)}
      className={`nav-item ${className} ${active ? 'active' : ''} ${
        droppable.isOver ? 'drop-over' : ''
      } ${draggable.isDragging ? 'dragging' : ''}`}
      title={title}
      aria-label={title}
      aria-current={active ? 'page' : undefined}
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
