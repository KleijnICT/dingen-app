import { addDays, type CalendarDate, parseTimestamp, type Task, toCalendarDate } from '@dingen/core'
import { useSyncExternalStore } from 'react'
import { api, type User } from './api.js'
import type { SyncEngine } from './store/engine.js'

/**
 * Today's "new tasks" banner (like Things): tasks that came into Today by themselves, because
 * the date they were planned for arrived. OK marks them seen for that day; the day lives on
 * the account, so every device knows.
 */

let seenOn: string | null = null
const listeners = new Set<() => void>()

function set(value: string | null) {
  if (value === seenOn) return
  seenOn = value
  for (const l of listeners) l()
}

function subscribe(l: () => void) {
  listeners.add(l)
  return () => listeners.delete(l)
}

export function initTodaySeen(user: User): void {
  set(user.todaySeenOn ?? null)
}

export function useTodaySeen(): string | null {
  return useSyncExternalStore(subscribe, () => seenOn)
}

/** OK on the banner: seen today, here at once and on the account. */
export async function markTodaySeen(today: CalendarDate): Promise<void> {
  set(today)
  try {
    await api.post('/api/auth/today-seen', { date: today })
  } catch {
    // Offline: the banner stays away here; another device may show it once more.
  }
}

/** Picks up an OK given on another device (the app comes back into view). */
export async function refreshTodaySeen(): Promise<void> {
  try {
    const { user } = await api.get<{ user: User }>('/api/auth/me')
    set(user.todaySeenOn ?? null)
  } catch {
    // Keep what we have.
  }
}

/** The day a task's When was last set, from the sync timestamp of that field. */
export function whenSetOn(engine: SyncEngine, task: Task): CalendarDate | null {
  const ts = engine.records.get(`task:${task.id}`)?.fieldTs.when
  return ts ? toCalendarDate(new Date(parseTimestamp(ts).wall)) : null
}

/**
 * Today's tasks that arrived by themselves since the banner was last seen: their date came
 * after `seenOn` (or is today, if never seen) and was set on an earlier day. What you move to
 * Today yourself does not count.
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
