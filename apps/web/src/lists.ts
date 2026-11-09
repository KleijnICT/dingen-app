import type { Task, When } from '@dingen/core'
import { toCalendarDate, views } from '@dingen/core'
import { formatDate, type MessageKey, t } from './i18n/index.js'

export type ListId = 'inbox' | 'today' | 'upcoming' | 'someday' | 'logbook'

export interface ListDef {
  id: ListId
  titleKey: MessageKey
  path: string
  /** `when` for a task added in this list; null means no quick add. */
  newWhen: (today: string) => When | null
}

export const LISTS: ListDef[] = [
  { id: 'inbox', titleKey: 'list.inbox', path: '/inbox', newWhen: () => ({ kind: 'inbox' }) },
  {
    id: 'today',
    titleKey: 'list.today',
    path: '/today',
    newWhen: (today) => ({ kind: 'date', date: today }),
  },
  {
    id: 'upcoming',
    titleKey: 'list.upcoming',
    path: '/upcoming',
    newWhen: (today) => ({ kind: 'date', date: addDays(today, 1) }),
  },
  {
    id: 'someday',
    titleKey: 'list.someday',
    path: '/someday',
    newWhen: () => ({ kind: 'someday' }),
  },
  { id: 'logbook', titleKey: 'list.logbook', path: '/logbook', newWhen: () => null },
]

export function listTasks(id: ListId, tasks: Task[], today: string): Task[] {
  switch (id) {
    case 'inbox':
      return views.inbox(tasks)
    case 'today':
      return views.today(tasks, today)
    case 'upcoming':
      return views.upcoming(tasks, today)
    case 'someday':
      return views.someday(tasks)
    case 'logbook':
      return views.logbook(tasks)
  }
}

export function countFor(id: ListId, tasks: Task[], today: string): number | null {
  if (id === 'logbook' || id === 'upcoming') return null
  return listTasks(id, tasks, today).length
}

export function parseDate(date: string): Date {
  const [y, m, d] = date.split('-').map(Number) as [number, number, number]
  return new Date(y, m - 1, d)
}

export function addDays(date: string, days: number): string {
  const base = parseDate(date)
  return toCalendarDate(new Date(base.getFullYear(), base.getMonth(), base.getDate() + days))
}

/** "today", "tomorrow", "Wednesday", "12 Nov", "3 Jan 2027", in the current locale. */
export function describeDate(date: string, today: string): string {
  if (date === today) return t('date.today')
  if (date === addDays(today, 1)) return t('date.tomorrow')
  const target = parseDate(date)
  const diff = Math.round((target.getTime() - parseDate(today).getTime()) / 86_400_000)
  if (diff > 1 && diff < 7) return formatDate(target, { weekday: 'long' })
  const sameYear = target.getFullYear() === parseDate(today).getFullYear()
  return formatDate(target, {
    day: 'numeric',
    month: 'short',
    ...(sameYear ? {} : { year: 'numeric' }),
  })
}

export function describeLongDate(date: string): string {
  return formatDate(parseDate(date), { weekday: 'long', day: 'numeric', month: 'long' })
}

export function describeWhen(when: When, today: string): string {
  switch (when.kind) {
    case 'inbox':
      return t('when.inbox')
    case 'anytime':
      return t('when.anytime')
    case 'someday':
      return t('when.someday')
    case 'date':
      return describeDate(when.date, today)
  }
}
