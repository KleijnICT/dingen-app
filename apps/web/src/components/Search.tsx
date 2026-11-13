import type { Task } from '@dingen/core'
import { views } from '@dingen/core'
import { TextSearch as SearchIcon } from 'lucide-react'
import { type KeyboardEvent, useEffect, useRef, useState } from 'react'
import { useT } from '../i18n/index.js'
import { containerOf, LISTS, listTasks } from '../lists.js'
import { areaPath, navigate, projectPath, taskPath } from '../router.js'
import { type SearchHit, searchWorkspace } from '../search.js'
import { useWorkspace, type Workspace } from '../store/context.js'
import { AreaGlyph } from './AreaIcons.js'
import { ProgressCircle } from './Icons.js'

/** Where a task lives: its project, its area, or the list that shows it. */
export function pathOf(task: Task, ws: Workspace): string {
  if (task.projectId) return projectPath(task.projectId)
  if (task.areaId) return areaPath(task.areaId)
  const list = LISTS.find((l) => listTasks(l.id, ws).some((x) => x.id === task.id))
  return list?.path ?? '/anytime'
}

/** Quick search over areas, projects and tasks; choosing one goes there. */
export function Search({ onClose }: { onClose: () => void }) {
  const t = useT()
  const ws = useWorkspace()
  const [query, setQuery] = useState('')
  const [active, setActive] = useState(0)
  const input = useRef<HTMLInputElement>(null)
  const hits = searchWorkspace(ws, query)

  useEffect(() => {
    input.current?.focus()
  }, [])

  function choose(hit: SearchHit) {
    onClose()
    if (hit.kind === 'area') navigate(areaPath(hit.item.id))
    else if (hit.kind === 'project') navigate(projectPath(hit.item.id))
    else {
      navigate(taskPath(pathOf(hit.item, ws), hit.item.id))
    }
  }

  function onKeyDown(e: KeyboardEvent) {
    if (e.key === 'Escape') {
      e.preventDefault()
      onClose()
    } else if (e.key === 'ArrowDown') {
      e.preventDefault()
      setActive((i) => Math.min(hits.length - 1, i + 1))
    } else if (e.key === 'ArrowUp') {
      e.preventDefault()
      setActive((i) => Math.max(0, i - 1))
    } else if (e.key === 'Enter') {
      const hit = hits[active]
      if (hit) choose(hit)
    }
  }

  return (
    <div
      className="settings-backdrop search-backdrop"
      onPointerDown={(e) => {
        if (e.target === e.currentTarget) onClose()
      }}
    >
      <div className="search" role="dialog" aria-modal="true" aria-label={t('toolbar.search')}>
        <div className="search-field">
          <SearchIcon size={18} aria-hidden="true" />
          <input
            ref={input}
            type="search"
            value={query}
            placeholder={t('search.placeholder')}
            aria-label={t('search.placeholder')}
            onChange={(e) => {
              setQuery(e.target.value)
              setActive(0)
            }}
            onKeyDown={onKeyDown}
          />
        </div>
        {query.trim() && (
          <ul className="search-results">
            {hits.length === 0 && <li className="muted search-empty">{t('search.none')}</li>}
            {hits.map((hit, i) => (
              <li key={`${hit.kind}:${hit.item.id}`}>
                <button
                  type="button"
                  className={`search-hit ${i === active ? 'active' : ''}`}
                  aria-current={i === active}
                  onPointerEnter={() => setActive(i)}
                  onClick={() => choose(hit)}
                >
                  <HitIcon hit={hit} ws={ws} />
                  <span className="search-title">{hit.item.title || t('task.untitled')}</span>
                  {hit.kind === 'task' && (
                    <span className="search-where">{containerOf(hit.item, ws)?.title ?? ''}</span>
                  )}
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  )
}

function HitIcon({ hit, ws }: { hit: SearchHit; ws: Workspace }) {
  if (hit.kind === 'area')
    return <AreaGlyph icon={hit.item.icon} color={hit.item.color} size={16} />
  if (hit.kind === 'project') {
    return <ProgressCircle value={views.progress(hit.item.id, ws.tasks)} size={16} />
  }
  return <span className="search-check" aria-hidden="true" />
}
