import type { Area, CalendarEvent, CalendarInfo, Project, Task } from '@dingen/core'
import { views } from '@dingen/core'
import { useSyncExternalStore } from 'react'

/**
 * The area filter of Today: only the tasks and projects of one area. A per-device choice,
 * stored in localStorage like the duration filter, so it stays until it is cleared.
 */

interface Containers {
  projectById: Map<string, Project>
}

/** The area a task belongs to, directly or through its project; null without one. */
export function areaOfTask(task: Task, ws: Containers): string | null {
  if (task.projectId) return ws.projectById.get(task.projectId)?.areaId ?? null
  return task.areaId
}

/** The tasks of one area; all of them without a filter. */
export function filterByArea(tasks: Task[], areaId: string | null, ws: Containers): Task[] {
  return areaId === null ? tasks : tasks.filter((task) => areaOfTask(task, ws) === areaId)
}

/**
 * The areas to choose from: those with a task or project in the list, plus the active one
 * (so it can always be seen and cleared), in sidebar order.
 */
export function filterAreas(
  tasks: Task[],
  projects: Project[],
  active: string | null,
  ws: Containers & { areaById: Map<string, Area> },
): Area[] {
  const ids = new Set<string | null>([
    ...tasks.map((task) => areaOfTask(task, ws)),
    ...projects.map((project) => project.areaId),
    active,
  ])
  return [...ids]
    .map((id) => (id ? ws.areaById.get(id) : undefined))
    .filter((area): area is Area => Boolean(area))
    .sort(views.byOrder)
}

/**
 * The appointments that go with an area filter: those of calendars of that area and of
 * calendars without an area (or with one that is gone). Only another area's calendar hides.
 */
export function filterEventsByArea(
  events: CalendarEvent[],
  calendars: CalendarInfo[],
  areaId: string | null,
  ws: { areaById: Map<string, Area> },
): CalendarEvent[] {
  if (areaId === null) return events
  const other = new Set(
    calendars
      .filter((c) => c.areaId && c.areaId !== areaId && ws.areaById.has(c.areaId))
      .map((c) => c.id),
  )
  return other.size === 0 ? events : events.filter((event) => !other.has(event.calendarId))
}

const KEY = 'dingen.todayArea'
const listeners = new Set<() => void>()

function read(): string | null {
  try {
    return localStorage.getItem(KEY) || null
  } catch {
    return null
  }
}

export function setTodayArea(areaId: string | null): void {
  try {
    if (areaId === null) localStorage.removeItem(KEY)
    else localStorage.setItem(KEY, areaId)
  } catch {
    // Private windows may refuse storage; the choice then lasts until reload.
  }
  for (const l of listeners) l()
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener)
  return () => listeners.delete(listener)
}

/** The stored area of Today's filter; the caller drops it when the area no longer exists. */
export function useTodayArea(): string | null {
  return useSyncExternalStore(subscribe, read, () => null)
}
