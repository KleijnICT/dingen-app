import { type Daypart, type Task, views } from '@dingen/core'
import { useDndContext } from '@dnd-kit/core'
import type { ReactNode } from 'react'
import { useCalendarData } from '../calendar.js'
import {
  type DaypartSlot,
  eventsByDaypart,
  SLOTS,
  showsDaypart,
  tasksByDaypart,
  totalText,
} from '../dayparts.js'
import type { TaskGroupInfo } from '../dnd.js'
import { useLocale, useT } from '../i18n/index.js'
import { navigate } from '../router.js'
import type { MoveTarget } from '../taskActions.js'
import { DayEvents } from './CalendarEvents.js'

/** A group of Today's tasks by project or area, as ListPage makes them. */
export interface ContainerGroup {
  key: string
  title: string
  href: string
  tasks: Task[]
  target: MoveTarget
}

interface Props {
  today: string
  tasks: Task[]
  view: 'manual' | 'grouped'
  /** Focus mode: only tasks, no events, no projects, no empty groups. */
  focus?: boolean
  /** The projects planned for today; above the tasks without a daypart. */
  projects: ReactNode
  /** A sortable group of rows (ListPage's `group`). */
  group: (
    key: string,
    target: MoveTarget | null,
    tasks: Task[],
    orderField: TaskGroupInfo['orderField'],
    showCaption: boolean | undefined,
    daypart?: Daypart | null,
  ) => ReactNode
  groupByContainer: (tasks: Task[]) => ContainerGroup[]
}

/**
 * Today in dayparts: first the tasks without a daypart (with all-day events
 * and the projects), then Morning, Afternoon and Evening, each only when it
 * has a task or an event, or while something is dragged. Events go under the
 * daypart of their start time. Dropping a task in a group sets its daypart.
 * A heading shows the estimated time of its open tasks.
 */
export function TodayBody({
  today,
  tasks,
  view,
  focus = false,
  projects,
  group,
  groupByContainer,
}: Props) {
  const t = useT()
  const locale = useLocale()
  const dragging = useDndContext().active !== null
  const { events } = useCalendarData()
  const byPart = tasksByDaypart(tasks)
  const eventsByPart = eventsByDaypart(focus ? [] : events, today)
  const todayWhen = { kind: 'date', date: today } as const

  const rows = (slot: DaypartSlot, items: Task[]) => {
    const daypart = slot === 'none' ? null : slot
    if (focus && items.length === 0 && !dragging) return null
    // "My order" is one list per daypart with its own order; "By project" follows each
    // project's order. An empty group is still a place to drop while dragging.
    if (view === 'manual' || items.length === 0) {
      return group(slot, { kind: 'when', when: todayWhen, daypart }, items, 'todayOrder', undefined)
    }
    return groupByContainer([...items].sort(views.byOrder)).map((g) => (
      <div key={g.key} className="group">
        {g.key !== 'none' && (
          <h3 className="group-title">
            <button type="button" className="group-link" onClick={() => navigate(g.href)}>
              {g.title}
            </button>
          </h3>
        )}
        {group(`${slot}:${g.key}`, g.target, g.tasks, 'order', false, daypart)}
      </div>
    ))
  }

  return (
    <>
      {!focus && <DayEvents date={today} slot="none" />}
      {!focus && projects}
      {rows('none', byPart.none)}
      {SLOTS.filter((slot): slot is Daypart => slot !== 'none').map((slot) => {
        const items = byPart[slot]
        if (!showsDaypart(items.length, eventsByPart[slot].length, dragging)) return null
        const total = totalText(items, locale)
        return (
          <section key={slot} className={`group daypart-group ${slot}`}>
            <h2 className="group-title daypart-title">
              <span>{t(`daypart.${slot}`)}</span>
              {total && (
                <span
                  className="duration-total"
                  title={t('today.daypartTotal', { duration: total })}
                >
                  {total}
                </span>
              )}
            </h2>
            {!focus && <DayEvents date={today} slot={slot} />}
            {rows(slot, items)}
          </section>
        )
      })}
    </>
  )
}

/** ` · 30m`: the estimated time of today's open tasks, after the date; nothing at zero. */
export function TodayTotal({ tasks }: { tasks: Task[] }) {
  const t = useT()
  const total = totalText(tasks, useLocale())
  if (!total) return null
  const label = t('today.total', { duration: total })
  return (
    <>
      <span aria-hidden="true"> · </span>
      <span className="day-total" title={label}>
        {total}
      </span>
    </>
  )
}
