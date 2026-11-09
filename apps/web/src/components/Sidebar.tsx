import type { Task } from '@dingen/core'
import type { ReactElement } from 'react'
import { countFor, LISTS, type ListId } from '../lists.js'
import { navigate } from '../router.js'
import type { SyncStatus } from '../store/engine.js'
import { CalendarIcon, InboxIcon, LogbookIcon, PersonIcon, SomedayIcon, StarIcon } from './Icons.js'

interface Props {
  path: string
  tasks: Task[]
  today: string
  status: SyncStatus
  email: string
}

const ICONS: Record<ListId, (p: { className?: string }) => ReactElement> = {
  inbox: InboxIcon,
  vandaag: StarIcon,
  binnenkort: CalendarIcon,
  ooit: SomedayIcon,
  logboek: LogbookIcon,
}

const STATUS_TEXT: Record<SyncStatus, string> = {
  idle: 'Gesynchroniseerd',
  syncing: 'Synchroniseren…',
  offline: 'Offline, wijzigingen staan in de wacht',
  unauthorized: 'Uitgelogd',
}

export function Sidebar({ path, tasks, today, status, email }: Props) {
  return (
    <nav className="sidebar" aria-label="Lijsten">
      <ul className="nav">
        {LISTS.map((list) => {
          const Icon = ICONS[list.id]
          const count = countFor(list.id, tasks, today)
          return (
            <li key={list.id}>
              <a
                href={list.path}
                className={`nav-item ${list.id} ${path === list.path ? 'active' : ''}`}
                onClick={(e) => {
                  e.preventDefault()
                  navigate(list.path)
                }}
              >
                <Icon className="nav-icon" />
                <span className="nav-title">{list.title}</span>
                {count !== null && count > 0 && <span className="nav-count">{count}</span>}
              </a>
            </li>
          )
        })}
      </ul>
      <div className="sidebar-foot">
        <a
          href="/account"
          className={`nav-item account ${path === '/account' ? 'active' : ''}`}
          onClick={(e) => {
            e.preventDefault()
            navigate('/account')
          }}
          title={email}
        >
          <PersonIcon className="nav-icon" />
          <span className="nav-title">Account</span>
        </a>
        <p className={`sync-status ${status}`} title={STATUS_TEXT[status]}>
          <span className="dot" />
          <span className="sync-text">{STATUS_TEXT[status]}</span>
        </p>
      </div>
    </nav>
  )
}
