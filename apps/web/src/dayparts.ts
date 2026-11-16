import {
  addDays,
  type CalendarEvent,
  DAYPARTS,
  type Daypart,
  daypartOf,
  eventSpan,
  eventsOnDay,
  formatDuration,
  type Task,
  totalDuration,
  type When,
  weekdayOf,
} from '@dingen/core'

/**
 * Dayparts in the web app (plan 25): the When picker's choices, Today in
 * groups (first the tasks without a daypart, then Morning, Afternoon and
 * Evening) with the calendar events under the daypart of their start time,
 * and the duration totals. Pure functions, so they can be tested without a
 * browser.
 */

/** A group in Today: the tasks without a daypart (`none`, at the top) or a daypart. */
export type DaypartSlot = Daypart | 'none'

export const SLOTS: readonly DaypartSlot[] = ['none', ...DAYPARTS]

/** The Monday of next week; on a Monday the one a week later, on a Sunday tomorrow. */
export function nextWeek(today: string): string {
  const daysToMonday = (8 - weekdayOf(today)) % 7 || 7
  return addDays(today, daysToMonday)
}

export type WhenChoice = 'inbox' | 'today' | 'tomorrow' | 'nextWeek' | 'anytime' | 'someday'

export interface WhenOption {
  key: WhenChoice
  when: When
  active: boolean
  /** A date keeps the picker open, so a daypart can follow; the rest closes it. */
  close: boolean
}

/** The choices of the When picker, in order. Projects have no Inbox. */
export function whenOptions(when: When, today: string, forProject = false): WhenOption[] {
  const date = when.kind === 'date' ? when.date : null
  const dated = (key: WhenChoice, day: string, active: boolean): WhenOption => ({
    key,
    when: { kind: 'date', date: day },
    active,
    close: forProject,
  })
  const plain = (key: 'inbox' | 'anytime' | 'someday'): WhenOption => ({
    key,
    when: { kind: key },
    active: when.kind === key,
    close: true,
  })
  const tomorrow = addDays(today, 1)
  const monday = nextWeek(today)
  return [
    ...(forProject ? [] : [plain('inbox')]),
    dated('today', today, date !== null && date <= today),
    dated('tomorrow', tomorrow, date === tomorrow),
    dated('nextWeek', monday, date === monday),
    plain('anytime'),
    plain('someday'),
  ]
}

/** The fields for a When and a daypart: without a date there is no daypart. */
export function whenFields(when: When, daypart: Daypart | null): Record<string, unknown> {
  return { when, daypart: when.kind === 'date' ? daypart : null }
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
 * Whether a daypart heading shows: when its group has a task or an event, or
 * while something is dragged (an empty group is then a place to drop).
 */
export function showsDaypart(tasks: number, events: number, dragging: boolean): boolean {
  return dragging || tasks + events > 0
}

/** A duration in the hour unit of the language: `1u30` in Dutch, `1h30` in English. */
export function durationText(minutes: number, locale: string): string {
  return formatDuration(minutes, locale === 'nl' ? 'u' : 'h')
}

/** The estimated time of the open tasks, as text; null when there is none. */
export function totalText(
  tasks: readonly Pick<Task, 'duration' | 'status'>[],
  locale: string,
): string | null {
  const minutes = totalDuration(tasks.filter((task) => task.status === 'open'))
  return minutes > 0 ? durationText(minutes, locale) : null
}
