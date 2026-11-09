import { newArea, newProject, orderBetween, views } from '@dingen/core'
import { type ReactElement, useState } from 'react'
import { useT } from '../i18n/index.js'
import { countFor, LISTS, type ListId } from '../lists.js'
import { areaPath, navigate, projectPath } from '../router.js'
import { useEngine, useWorkspace } from '../store/context.js'
import type { SyncStatus } from '../store/engine.js'
import {
  AnytimeIcon,
  AreaIcon,
  CalendarIcon,
  InboxIcon,
  LogbookIcon,
  PersonIcon,
  PlusIcon,
  ProgressCircle,
  SomedayIcon,
  StarIcon,
} from './Icons.js'

interface Props {
  path: string
  status: SyncStatus
  email: string
}

const ICONS: Record<ListId, (p: { className?: string }) => ReactElement> = {
  inbox: InboxIcon,
  today: StarIcon,
  upcoming: CalendarIcon,
  anytime: AnytimeIcon,
  someday: SomedayIcon,
  logbook: LogbookIcon,
}

export function Sidebar({ path, status, email }: Props) {
  const t = useT()
  const engine = useEngine()
  const ws = useWorkspace()
  const [adding, setAdding] = useState(false)
  const statusText = t(`sync.${status}`)

  function link(href: string, className: string, content: ReactElement, title?: string) {
    return (
      <a
        href={href}
        className={`nav-item ${className} ${path === href ? 'active' : ''}`}
        title={title}
        onClick={(e) => {
          e.preventDefault()
          navigate(href)
        }}
      >
        {content}
      </a>
    )
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

  const projectItem = (p: { id: string; title: string }) =>
    link(
      projectPath(p.id),
      'project',
      <>
        <ProgressCircle value={views.progress(p.id, ws.tasks)} className="nav-icon" />
        <span className="nav-title">{p.title || <em>{t('project.untitled')}</em>}</span>
      </>,
    )

  return (
    <nav className="sidebar" aria-label={t('nav.lists')}>
      <div className="sidebar-scroll">
        <ul className="nav">
          {LISTS.map((list) => {
            const Icon = ICONS[list.id]
            const count = countFor(list.id, ws)
            return (
              <li key={list.id}>
                {link(
                  list.path,
                  list.id,
                  <>
                    <Icon className="nav-icon" />
                    <span className="nav-title">{t(list.titleKey)}</span>
                    {count !== null && count > 0 && <span className="nav-count">{count}</span>}
                  </>,
                )}
              </li>
            )
          })}
        </ul>
        <ul className="nav tree">
          {views.projectsOf(ws.projects, null).map((p) => (
            <li key={p.id}>{projectItem(p)}</li>
          ))}
          {views.openAreas(ws.areas).map((area) => (
            <li key={area.id} className="area-group">
              {link(
                areaPath(area.id),
                'area',
                <>
                  <AreaIcon className="nav-icon" />
                  <span className="nav-title">{area.title || <em>{t('area.untitled')}</em>}</span>
                </>,
              )}
              <ul className="nav">
                {views.projectsOf(ws.projects, area.id).map((p) => (
                  <li key={p.id}>{projectItem(p)}</li>
                ))}
              </ul>
            </li>
          ))}
        </ul>
      </div>
      <div className="sidebar-foot">
        {adding ? (
          <div className="nav-add-menu">
            <button type="button" className="link" onClick={() => addProject(null)}>
              {t('nav.newProject')}
            </button>
            <button type="button" className="link" onClick={addArea}>
              {t('nav.newArea')}
            </button>
            <button type="button" className="link muted" onClick={() => setAdding(false)}>
              ×
            </button>
          </div>
        ) : (
          <button type="button" className="nav-item nav-add" onClick={() => setAdding(true)}>
            <PlusIcon className="nav-icon" />
            <span className="nav-title">{t('nav.new')}</span>
          </button>
        )}
        {link(
          '/account',
          'account',
          <>
            <PersonIcon className="nav-icon" />
            <span className="nav-title">{t('nav.account')}</span>
          </>,
          email,
        )}
        <p className={`sync-status ${status}`} title={statusText}>
          <span className="dot" />
          <span className="sync-text">{statusText}</span>
        </p>
      </div>
    </nav>
  )
}
