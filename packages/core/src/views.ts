import type { CalendarDate, Project, Task } from './entities.js'
import { compareOrder } from './order.js'

/**
 * De lijsten van Things als pure functies. Gedeeld door web, server en MCP,
 * zodat "Vandaag" overal hetzelfde betekent.
 */

export function isOpen(item: Task | Project): boolean {
  return !item.deleted && item.status === 'open'
}

export function isInbox(task: Task): boolean {
  return isOpen(task) && task.when.kind === 'inbox'
}

export function isToday(item: Task | Project, today: CalendarDate): boolean {
  return isOpen(item) && item.when.kind === 'date' && item.when.date <= today
}

export function isUpcoming(item: Task | Project, today: CalendarDate): boolean {
  return isOpen(item) && item.when.kind === 'date' && item.when.date > today
}

/** Anytime: alles wat nu beschikbaar is, inclusief Vandaag, zonder Inbox en Ooit. */
export function isAnytime(item: Task | Project, today: CalendarDate): boolean {
  return isOpen(item) && (item.when.kind === 'anytime' || isToday(item, today))
}

export function isSomeday(item: Task | Project): boolean {
  return isOpen(item) && item.when.kind === 'someday'
}

export function isLogbook(item: Task | Project): boolean {
  return !item.deleted && item.status !== 'open'
}

export function byOrder<T extends { order: string }>(a: T, b: T): number {
  return compareOrder(a.order, b.order)
}

export function byCompletedDesc<T extends { completedAt: string | null }>(a: T, b: T): number {
  return (b.completedAt ?? '').localeCompare(a.completedAt ?? '')
}

export function inbox(tasks: Task[]): Task[] {
  return tasks.filter(isInbox).sort(byOrder)
}

export function today(tasks: Task[], date: CalendarDate): Task[] {
  return tasks.filter((t) => isToday(t, date)).sort(byOrder)
}

export function upcoming(tasks: Task[], date: CalendarDate): Task[] {
  return tasks
    .filter((t) => isUpcoming(t, date))
    .sort((a, b) => {
      const da = a.when.kind === 'date' ? a.when.date : ''
      const db = b.when.kind === 'date' ? b.when.date : ''
      return da.localeCompare(db) || byOrder(a, b)
    })
}

export function anytime(tasks: Task[], date: CalendarDate): Task[] {
  return tasks.filter((t) => isAnytime(t, date)).sort(byOrder)
}

export function someday(tasks: Task[]): Task[] {
  return tasks.filter(isSomeday).sort(byOrder)
}

export function logbook(tasks: Task[]): Task[] {
  return tasks.filter(isLogbook).sort(byCompletedDesc)
}

/** Kalenderdatum van een tijdstip in de lokale tijdzone van de aanroeper. */
export function toCalendarDate(d: Date = new Date()): CalendarDate {
  const y = d.getFullYear()
  const m = String(d.getMonth() + 1).padStart(2, '0')
  const day = String(d.getDate()).padStart(2, '0')
  return `${y}-${m}-${day}`
}
