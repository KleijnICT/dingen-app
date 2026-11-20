import { type Area, type Project, type ReviewEntry, reviewQueue, views } from '@dingen/core'
import { Check, ChevronLeft } from 'lucide-react'
import { useContext, useMemo, useState } from 'react'
import { createPortal } from 'react-dom'
import { formatAgo, useT } from '../i18n/index.js'
import { openCount, reviewAge, selectAfterReviewed } from '../reviewList.js'
import { useEngine, useWorkspace } from '../store/context.js'
import { AreaGlyph } from './AreaIcons.js'
import { AreaPage } from './AreaPage.js'
import { EmptyState } from './EmptyState.js'
import { ProgressCircle } from './Icons.js'
import { Pane, PaneHeader } from './Pane.js'
import { ProjectPage } from './ProjectPage.js'
import { useNarrow } from './SidebarDrawer.js'
import { SideSlot } from './SideSlot.js'

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
  const sideSlot = useContext(SideSlot)
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
      selectedId={selected?.item.id ?? null}
      onSelect={select}
      inline={narrow}
    />
  )

  if (!selected) {
    if (queue.length === 0 || !narrow) {
      return (
        <section className="list-page review-page">
          <header className="list-header">
            <h1>{t('review.title')}</h1>
          </header>
          <EmptyState title={t('review.empty')} text={t('review.empty.hint')} />
        </section>
      )
    }
    // A phone, nothing opened yet: the list only.
    return <section className="list-page review-page">{list}</section>
  }

  const mark = (
    <button
      type="button"
      className="button-secondary review-mark"
      onClick={() => markReviewed(selected)}
    >
      <Check size={14} aria-hidden="true" />
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
        showProjects={false}
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

  // Wide: the list takes the sidebar's place (the sidebar folds to a rail of icons), the item
  // fills the content area as its own page would.
  return (
    <>
      {sideSlot && createPortal(list, sideSlot)}
      {detail}
    </>
  )
}

interface QueueProps {
  queue: ReviewEntry[]
  selectedId: string | null
  onSelect: (id: string) => void
  /** On a phone the list is the page: a page title instead of a pane head. */
  inline: boolean
}

/** The list of what is due, in sidebar order, each with when it was last reviewed. */
function ReviewQueue({ queue, selectedId, onSelect, inline }: QueueProps) {
  const t = useT()
  const ws = useWorkspace()
  const dueAreas = new Set(queue.filter((e) => e.kind === 'area').map((e) => e.item.id))
  return (
    <Pane
      as="nav"
      className="review-queue"
      label={t('review.queue')}
      header={
        inline ? (
          <header className="list-header">
            <h1>{t('review.title')}</h1>
          </header>
        ) : (
          <PaneHeader title={t('review.title')} count={queue.length} />
        )
      }
    >
      {queue.length === 0 && <EmptyState title={t('review.empty')} text={t('review.empty.hint')} />}
      {queue.length > 0 && (
        <ul className="nav">
          {queue.map((entry) => {
            const { item } = entry
            const active = item.id === selectedId
            // A project sits under its area, as in the sidebar, when that area is due too.
            const nested = entry.kind === 'project' && dueAreas.has(entry.item.areaId ?? '')
            return (
              <li key={item.id}>
                <button
                  type="button"
                  className={`nav-item review-item ${entry.kind}${nested ? ' nested' : ''}${active ? ' active' : ''}`}
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
                      someday={views.isSomeday(entry.item)}
                      className="nav-icon"
                    />
                  )}
                  <span className="review-item-text">
                    <span className="nav-title">
                      {item.title || (
                        <em>{t(entry.kind === 'area' ? 'area.untitled' : 'project.untitled')}</em>
                      )}
                    </span>
                    <ReviewNote entry={entry} />
                  </span>
                </button>
              </li>
            )
          })}
        </ul>
      )}
    </Pane>
  )
}

/** "last reviewed 3 weeks ago · 4 open"; in a narrow list it breaks at the dot. */
function ReviewNote({ entry }: { entry: ReviewEntry }) {
  const t = useT()
  const ws = useWorkspace()
  const age = reviewAge(entry.item.reviewedAt, ws.today)
  const last =
    age === null
      ? t('review.never')
      : age.unit === 'day' && age.n === 0
        ? t('review.lastToday')
        : t('review.last', { when: formatAgo(age.n, age.unit) })
  return (
    <span className="review-item-note">
      <span className="review-note-part">{last}</span> ·{' '}
      <span className="review-note-part">
        {t('review.open', { n: openCount(entry, ws.tasks) })}
      </span>
    </span>
  )
}
