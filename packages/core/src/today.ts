import { type CalendarEvent, eventSpan, eventsOnDay } from './calendar.js'
import { addDays, weekdayOf } from './dates.js'
import { DAYPARTS, daypartOf } from './dayparts.js'
import type { CalendarDate, Daypart, Task } from './entities.js'

/**
 * Today's layout, shared by every client (plan 25): the groups of Today
 * (first the tasks without a daypart, then Morning, Afternoon and Evening)
 * with the calendar events under the daypart of their start time, "Next
 * week" in the When picker, and which tasks are new in Today.
 */

/** A group in Today: the tasks without a daypart (`none`, at the top) or a daypart. */
export type DaypartSlot = Daypart | 'none'

export const SLOTS: readonly DaypartSlot[] = ['none', ...DAYPARTS]

/** The Monday of next week; on a Monday the one a week later, on a Sunday tomorrow. */
export function nextWeek(today: string): string {
  const daysToMonday = (8 - weekdayOf(today)) % 7 || 7
  return addDays(today, daysToMonday)
}

/** Tasks per group, in the order given. */
export function tasksByDaypart<T extends Pick<Task, 'daypart'>>(
  tasks: readonly T[],
): Record<DaypartSlot, T[]> {
  const groups: Record<DaypartSlot, T[]> = { none: [], morning: [], afternoon: [], evening: [] }
  for (const task of tasks) groups[task.daypart ?? 'none'].push(task)
  return groups
}

/**
 * The events of a day per group, in the order of `eventsOnDay`. An event goes
 * under the daypart of its start time; all-day events and those that started
 * on an earlier day stay at the top.
 */
export function eventsByDaypart(
  events: readonly CalendarEvent[],
  date: string,
): Record<DaypartSlot, CalendarEvent[]> {
  const groups: Record<DaypartSlot, CalendarEvent[]> = {
    none: [],
    morning: [],
    afternoon: [],
    evening: [],
  }
  for (const event of eventsOnDay([...events], date)) {
    const span = eventSpan(event, date)
    const start = span === 'single' || span === 'first' ? event.startTime : null
    groups[start ? daypartOf(start) : 'none'].push(event)
  }
  return groups
}

/**
 * Today's tasks that arrived by themselves since the banner was last seen: their date came
 * after `seen` (or is today, if never seen) and was set on an earlier day. What you move to
 * Today yourself does not count. `setOn` is the day the task's `when` was last set: the
 * calendar date, on the device's clock, of the wall time of the field's sync timestamp.
 */
export function newInToday(
  tasks: Task[],
  setOn: (task: Task) => CalendarDate | null,
  today: CalendarDate,
  seen: CalendarDate | null,
): Task[] {
  const after = seen ?? addDays(today, -1)
  return tasks.filter((task) => {
    if (task.status !== 'open' || task.when.kind !== 'date') return false
    const date = task.when.date
    if (date > today || date <= after) return false
    const on = setOn(task)
    return on !== null && on < date
  })
}
