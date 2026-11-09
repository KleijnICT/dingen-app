import type { Task, When } from '@dingen/core'
import { toCalendarDate, views } from '@dingen/core'
import type { ReactNode } from 'react'

export type ListId = 'inbox' | 'vandaag' | 'binnenkort' | 'ooit' | 'logboek'

export interface ListDef {
  id: ListId
  title: string
  path: string
  /** `when` voor een taak die in deze lijst wordt toegevoegd; null: geen snel toevoegen. */
  newWhen: (today: string) => When | null
}

export const LISTS: ListDef[] = [
  { id: 'inbox', title: 'Inbox', path: '/inbox', newWhen: () => ({ kind: 'inbox' }) },
  {
    id: 'vandaag',
    title: 'Vandaag',
    path: '/vandaag',
    newWhen: (today) => ({ kind: 'date', date: today }),
  },
  {
    id: 'binnenkort',
    title: 'Binnenkort',
    path: '/binnenkort',
    newWhen: (today) => ({ kind: 'date', date: addDays(today, 1) }),
  },
  { id: 'ooit', title: 'Ooit', path: '/ooit', newWhen: () => ({ kind: 'someday' }) },
  { id: 'logboek', title: 'Logboek', path: '/logboek', newWhen: () => null },
]

export function listTasks(id: ListId, tasks: Task[], today: string): Task[] {
  switch (id) {
    case 'inbox':
      return views.inbox(tasks)
    case 'vandaag':
      return views.today(tasks, today)
    case 'binnenkort':
      return views.upcoming(tasks, today)
    case 'ooit':
      return views.someday(tasks)
    case 'logboek':
      return views.logbook(tasks)
  }
}

export function countFor(id: ListId, tasks: Task[], today: string): number | null {
  if (id === 'logboek' || id === 'binnenkort') return null
  return listTasks(id, tasks, today).length
}

export function addDays(date: string, days: number): string {
  const [y, m, d] = date.split('-').map(Number) as [number, number, number]
  const next = new Date(y, m - 1, d + days)
  return toCalendarDate(next)
}

const DAY_NAMES = ['zondag', 'maandag', 'dinsdag', 'woensdag', 'donderdag', 'vrijdag', 'zaterdag']
const MONTHS = ['jan', 'feb', 'mrt', 'apr', 'mei', 'jun', 'jul', 'aug', 'sep', 'okt', 'nov', 'dec']

/** "morgen", "woensdag", "12 nov", "3 jan 2027". */
export function describeDate(date: string, today: string): string {
  if (date === today) return 'vandaag'
  if (date === addDays(today, 1)) return 'morgen'
  const [y, m, d] = date.split('-').map(Number) as [number, number, number]
  const target = new Date(y, m - 1, d)
  const diff = Math.round((target.getTime() - parseDate(today).getTime()) / 86_400_000)
  if (diff > 1 && diff < 7) return DAY_NAMES[target.getDay()] as string
  const base = `${d} ${MONTHS[m - 1]}`
  return y === parseDate(today).getFullYear() ? base : `${base} ${y}`
}

export function parseDate(date: string): Date {
  const [y, m, d] = date.split('-').map(Number) as [number, number, number]
  return new Date(y, m - 1, d)
}

export function describeWhen(when: When, today: string): ReactNode {
  switch (when.kind) {
    case 'inbox':
      return 'Inbox'
    case 'anytime':
      return 'Anytime'
    case 'someday':
      return 'Ooit'
    case 'date':
      return describeDate(when.date, today)
  }
}
