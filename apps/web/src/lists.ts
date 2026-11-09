import type { Area, Project, Task, When } from '@dingen/core'
import { toCalendarDate, views } from '@dingen/core'
import { formatDate, type MessageKey, t } from './i18n/index.js'
import type { Workspace } from './store/context.js'

export type ListId = 'inbox' | 'today' | 'upcoming' | 'anytime' | 'someday' | 'logbook'

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
    id: 'anytime',
    titleKey: 'list.anytime',
    path: '/anytime',
    newWhen: () => ({ kind: 'anytime' }),
  },
  {
    id: 'someday',
    titleKey: 'list.someday',
    path: '/someday',
    newWhen: () => ({ kind: 'someday' }),
  },
  { id: 'logbook', titleKey: 'list.logbook', path: '/logbook', newWhen: () => null },
]

export function listTasks(id: ListId, ws: Workspace): Task[] {
  const avail = views.available(ws.tasks, ws.projects)
  switch (id) {
    case 'inbox':
      return views.inbox(avail)
    case 'today':
      return views.today(avail, ws.today)
    case 'upcoming':
      return views.upcoming(avail, ws.today)
    case 'anytime':
      return views.anytime(views.notInSomedayProject(avail, ws.projects), ws.today)
    case 'someday':
      return views.someday(avail)
    case 'logbook':
      return views.logbook(ws.tasks)
  }
}

/** Projects that are themselves planned on this list. */
export function listProjects(id: ListId, ws: Workspace): Project[] {
  switch (id) {
    case 'today':
      return ws.projects.filter((p) => views.isToday(p, ws.today)).sort(views.byOrder)
    case 'upcoming':
      return ws.projects.filter((p) => views.isUpcoming(p, ws.today)).sort(views.byOrder)
    case 'someday':
      return ws.projects.filter(views.isSomeday).sort(views.byOrder)
    case 'logbook':
      return ws.projects.filter(views.isLogbook).sort(views.byCompletedDesc)
    default:
      return []
  }
}

export function countFor(id: ListId, ws: Workspace): number | null {
  if (id === 'logbook' || id === 'upcoming' || id === 'anytime' || id === 'someday') return null
  return listTasks(id, ws).length
}

/** The project or area a task belongs to, for the caption under its title. */
export function containerOf(task: Task, ws: Workspace): Project | Area | null {
  if (task.projectId) return ws.projectById.get(task.projectId) ?? null
  if (task.areaId) return ws.areaById.get(task.areaId) ?? null
  return null
}

/**
 * Sidebar order of containers: loose projects first, then each area with its
 * projects. Used for grouping Anytime and Someday the same way.
 */
export interface ContainerGroup {
  key: string
  area: Area | null
  project: Project | null
}

export function containerGroups(ws: Workspace): ContainerGroup[] {
  const groups: ContainerGroup[] = []
  for (const p of views.projectsOf(ws.projects, null)) {
    groups.push({ key: `project:${p.id}`, area: null, project: p })
  }
  for (const a of views.openAreas(ws.areas)) {
    groups.push({ key: `area:${a.id}`, area: a, project: null })
    for (const p of views.projectsOf(ws.projects, a.id)) {
      groups.push({ key: `project:${p.id}`, area: a, project: p })
    }
  }
  return groups
}

export function groupKeyOf(task: Task): string {
  if (task.projectId) return `project:${task.projectId}`
  if (task.areaId) return `area:${task.areaId}`
  return 'none'
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
  if (date === addDays(today, -1)) return t('date.yesterday')
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
