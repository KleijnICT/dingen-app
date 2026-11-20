import { type Area, type Project, type ReviewEntry, reviewQueue, views } from '@dingen/core'
import { Check, ChevronLeft } from 'lucide-react'
import { useMemo, useState } from 'react'
import { useT } from '../i18n/index.js'
import { describeDate } from '../lists.js'
import { groupByReviewDate, selectAfterReviewed } from '../reviewList.js'
import { useEngine, useWorkspace } from '../store/context.js'
import { AreaGlyph } from './AreaIcons.js'
import { AreaPage } from './AreaPage.js'
import { ProgressCircle } from './Icons.js'
import { ProjectPage } from './ProjectPage.js'
import { useNarrow } from './SidebarDrawer.js'

interface Props {
  focusSignal: number
}

type Selected = { kind: 'project'; item: Project } | { kind: 'area'; item: Area }

/**
 * Route /review: the projects and areas due for review, grouped by review date, with the
 * selected one beside the list, editable as on its own page. "Mark reviewed" moves on to
 * the next. On a phone the list comes first and an item opens full width.
 */
export function ReviewPage({ focusSignal }: Props) {
  const t = useT()
  const engine = useEngine()
  const ws = useWorkspace()
  const narrow = useNarrow()
  const queue = useMemo(() => reviewQueue(ws, ws.today), [ws])
  // The item picked in the list; on a wide screen nothing picked means the first one.
  const [picked, setPicked] = useState<string | null>(null)

  const lookup = (id: string | null | undefined): Selected | null => {
    if (!id) return null
    const project = ws.projectById.get(id)
    if (project && !project.deleted) return { kind: 'project', item: project }
    const area = ws.areaById.get(id)
    if (area && !area.deleted) return { kind: 'area', item: area }
    return null
  }
  const selected = lookup(picked) ?? (narrow ? null : lookup(queue[0]?.item.id))

  function select(id: string | null) {
    setPicked(id)
    document.querySelector('.content')?.scrollTo({ top: 0 })
  }

  function markReviewed(sel: Selected) {
    const next = selectAfterReviewed(queue, sel.item.id)
    engine.mutate(sel.kind, sel.item.id, { reviewedAt: new Date().toISOString() })
    select(next)
  }

  const list = (
    <ReviewQueue
      queue={queue}
      today={ws.today}
      selectedId={selected?.item.id ?? null}
      onSelect={select}
    />
  )

  if (!selected) {
    if (queue.length === 0) {
      return (
        <section className="list-page review-page">
          <header className="list-header">
            <h1>{t('review.title')}</h1>
          </header>
          <div className="empty review-empty">
            <p>{t('review.empty')}</p>
            <p className="muted">{t('review.empty.hint')}</p>
          </div>
        </section>
      )
    }
    // A phone, nothing opened yet: the list only.
    return <section className="list-page review-page">{list}</section>
  }

  const mark = (
    <button type="button" className="review-mark" onClick={() => markReviewed(selected)}>
      <Check size={15} strokeWidth={2.4} aria-hidden="true" />
      {t('review.markReviewed')}
    </button>
  )
  const detail =
    selected.kind === 'project' ? (
      <ProjectPage
        key={selected.item.id}
        project={selected.item}
        focusSignal={focusSignal}
        headerExtra={mark}
      />
    ) : (
      <AreaPage
        key={selected.item.id}
        area={selected.item}
        focusSignal={focusSignal}
        headerExtra={mark}
      />
    )

  if (narrow) {
    return (
      <div className="review-detail">
        <button type="button" className="link review-back" onClick={() => select(null)}>
          <ChevronLeft size={16} aria-hidden="true" />
          {t('review.back')}
        </button>
        {detail}
      </div>
    )
  }

  return (
    <div className="review-split">
      <div className="review-side">{list}</div>
      <div className="review-detail">{detail}</div>
    </div>
  )
}

interface QueueProps {
  queue: ReviewEntry[]
  today: string
  selectedId: string | null
  onSelect: (id: string) => void
}

/** The list of what is due, under a heading per review date. */
function ReviewQueue({ queue, today, selectedId, onSelect }: QueueProps) {
  const t = useT()
  const ws = useWorkspace()
  return (
    <nav className="review-queue" aria-label={t('review.queue')}>
      <header className="list-header">
        <h1>{t('review.title')}</h1>
      </header>
      {queue.length === 0 && <p className="empty">{t('review.empty')}</p>}
      {groupByReviewDate(queue).map((group) => (
        <div key={group.date} className="review-group">
          <h2 className="group-title review-group-title">
            {capitalize(describeDate(group.date, today))}
          </h2>
          <ul className="nav">
            {group.entries.map((entry) => {
              const { item } = entry
              const active = item.id === selectedId
              return (
                <li key={item.id}>
                  <button
                    type="button"
                    className={`nav-item review-item ${entry.kind} ${active ? 'active' : ''}`}
                    aria-current={active ? 'true' : undefined}
                    onClick={() => onSelect(item.id)}
                  >
                    {entry.kind === 'area' ? (
                      <AreaGlyph
                        icon={entry.item.icon}
                        color={entry.item.color}
                        className="nav-icon"
                      />
                    ) : (
                      <ProgressCircle
                        value={views.progress(item.id, ws.tasks)}
                        className="nav-icon"
                      />
                    )}
                    <span className="nav-title">
                      {item.title || (
                        <em>{t(entry.kind === 'area' ? 'area.untitled' : 'project.untitled')}</em>
                      )}
                    </span>
                  </button>
                </li>
              )
            })}
          </ul>
        </div>
      ))}
    </nav>
  )
}

const capitalize = (s: string) => s.charAt(0).toUpperCase() + s.slice(1)
