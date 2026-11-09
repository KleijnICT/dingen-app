import type { Task } from '@dingen/core'
import type { ReactElement } from 'react'
import { useT } from '../i18n/index.js'
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
  today: StarIcon,
  upcoming: CalendarIcon,
  someday: SomedayIcon,
  logbook: LogbookIcon,
}

export function Sidebar({ path, tasks, today, status, email }: Props) {
  const t = useT()
  const statusText = t(`sync.${status}`)
  return (
    <nav className="sidebar" aria-label={t('nav.lists')}>
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
                <span className="nav-title">{t(list.titleKey)}</span>
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
          <span className="nav-title">{t('nav.account')}</span>
        </a>
        <p className={`sync-status ${status}`} title={statusText}>
          <span className="dot" />
          <span className="sync-text">{statusText}</span>
        </p>
      </div>
    </nav>
  )
}
