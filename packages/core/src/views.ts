import { toCalendarDate } from './dates.js'
import type { Area, CalendarDate, ChecklistItem, Heading, Project, Task } from './entities.js'
import { compareOrder } from './order.js'

export { toCalendarDate }

/**
 * De lijsten van Things als pure functies. Gedeeld door web, server en MCP,
 * zodat "Vandaag" overal hetzelfde betekent.
 */

export function isOpen(item: Task | Project): boolean {
  return !item.deleted && item.status === 'open' && !('repeat' in item && item.repeat !== null)
}

export function isInbox(task: Task): boolean {
  return isOpen(task) && task.when.kind === 'inbox'
}

/** Vandaag: gepland voor vandaag of eerder, of een deadline die vandaag of eerder is. */
export function isToday(item: Task | Project, today: CalendarDate): boolean {
  if (!isOpen(item)) return false
  if (item.when.kind === 'date' && item.when.date <= today) return true
  return item.deadline !== null && item.deadline <= today
}

/** De datum waarop een item in Binnenkort staat: zijn datum, anders zijn deadline. */
export function upcomingDate(item: Task | Project, today: CalendarDate): CalendarDate | null {
  if (!isOpen(item) || isToday(item, today)) return null
  if (item.when.kind === 'date') return item.when.date
  return item.deadline !== null && item.deadline > today ? item.deadline : null
}

export function isUpcoming(item: Task | Project, today: CalendarDate): boolean {
  return upcomingDate(item, today) !== null
}

/** Anytime: alles wat nu beschikbaar is, inclusief Vandaag, zonder Inbox en Ooit. */
export function isAnytime(item: Task | Project, today: CalendarDate): boolean {
  return isOpen(item) && (item.when.kind === 'anytime' || isToday(item, today))
}

/**
 * Taken zonder project, of met een open project. Taken van een afgerond,
 * geannuleerd of verwijderd project zijn nergens zichtbaar behalve in het
 * Logboek; de lijstfuncties verwachten deze filtering vooraf.
 */
export function available(tasks: Task[], projects: Project[]): Task[] {
  const open = new Set(projects.filter(isOpen).map((p) => p.id))
  return tasks.filter((t) => t.projectId === null || open.has(t.projectId))
}

/** Taken van projecten die niet op Ooit staan; voor Anytime. */
export function notInSomedayProject(tasks: Task[], projects: Project[]): Task[] {
  const someday = new Set(projects.filter(isSomeday).map((p) => p.id))
  return tasks.filter((t) => t.projectId === null || !someday.has(t.projectId))
}

/** Taken van een project, zonder templates. */
export function projectTasks(tasks: Task[], projectId: string): Task[] {
  return tasks
    .filter((t) => !t.deleted && t.repeat === null && t.projectId === projectId)
    .sort(byOrder)
}

export function headingsOf(headings: Heading[], projectId: string): Heading[] {
  return headings.filter((h) => !h.deleted && h.projectId === projectId).sort(byOrder)
}

/** Taken direct in een gebied (niet via een project). */
export function areaTasks(tasks: Task[], areaId: string): Task[] {
  return tasks
    .filter((t) => !t.deleted && t.repeat === null && t.projectId === null && t.areaId === areaId)
    .sort(byOrder)
}

export function projectsOf(projects: Project[], areaId: string | null): Project[] {
  return projects.filter((p) => isOpen(p) && p.areaId === areaId).sort(byOrder)
}

export function checklistOf(items: ChecklistItem[], taskId: string): ChecklistItem[] {
  return items.filter((i) => !i.deleted && i.taskId === taskId).sort(byOrder)
}

export function checklistProgress(items: ChecklistItem[]): { done: number; total: number } {
  return { done: items.filter((i) => i.done).length, total: items.length }
}

export function openAreas(areas: Area[]): Area[] {
  return areas.filter((a) => !a.deleted).sort(byOrder)
}

/** Voortgang van een project: afgerond / (open + afgerond), 0 zonder taken. */
export function progress(projectId: string, tasks: Task[]): number {
  let open = 0
  let done = 0
  for (const t of tasks) {
    if (t.deleted || t.repeat !== null || t.projectId !== projectId) continue
    if (t.status === 'open') open += 1
    else if (t.status === 'completed') done += 1
  }
  return open + done === 0 ? 0 : done / (open + done)
}

export function isSomeday(item: Task | Project): boolean {
  return isOpen(item) && item.when.kind === 'someday'
}

export function isLogbook(item: Task | Project): boolean {
  return !item.deleted && item.status !== 'open' && !('repeat' in item && item.repeat !== null)
}

export function byOrder<T extends { order: string }>(a: T, b: T): number {
  return compareOrder(a.order, b.order)
}

/** Vandaag heeft een eigen volgorde; zonder eigen plek volgt een taak zijn projectvolgorde. */
export function todayKey(task: Task): string {
  return task.todayOrder ?? task.order
}

export function byTodayOrder(a: Task, b: Task): number {
  return compareOrder(todayKey(a), todayKey(b))
}

export function byCompletedDesc<T extends { completedAt: string | null }>(a: T, b: T): number {
  return (b.completedAt ?? '').localeCompare(a.completedAt ?? '')
}

export function inbox(tasks: Task[]): Task[] {
  return tasks.filter(isInbox).sort(byOrder)
}

export function today(tasks: Task[], date: CalendarDate): Task[] {
  return tasks.filter((t) => isToday(t, date)).sort(byTodayOrder)
}

export function upcoming(tasks: Task[], date: CalendarDate): Task[] {
  return tasks
    .filter((t) => isUpcoming(t, date))
    .sort((a, b) => {
      const da = upcomingDate(a, date) ?? ''
      const db = upcomingDate(b, date) ?? ''
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
