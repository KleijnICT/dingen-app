import type { Snapshot } from './actions.js'
import { addDays, addMonths, daysBetween, toCalendarDate } from './dates.js'
import type { Area, CalendarDate, Project, ReviewEvery, Task } from './entities.js'
import * as views from './views.js'

/**
 * The review (plan 29): every project and area has a review frequency. Once
 * that time has passed since it was last marked reviewed, it is due and shows
 * in the Review list. Marking it reviewed sets `reviewedAt` to now, so it
 * comes back one frequency after today. An area behaves like a project.
 * Web, server and MCP share these functions.
 */

/** The frequency when an item has none of its own. */
export const DEFAULT_REVIEW_EVERY: ReviewEvery = { n: 1, unit: 'week' }

/** The calendar date of an instant, in the caller's time zone. */
export function dateOf(iso: string): CalendarDate {
  return toCalendarDate(new Date(iso))
}

export function reviewEveryOf(item: Project | Area): ReviewEvery {
  return item.reviewEvery ?? DEFAULT_REVIEW_EVERY
}

/** A date plus a review frequency. */
export function addReviewEvery(date: CalendarDate, every: ReviewEvery): CalendarDate {
  switch (every.unit) {
    case 'day':
      return addDays(date, every.n)
    case 'week':
      return addDays(date, every.n * 7)
    case 'month':
      return addMonths(date, every.n)
    case 'year':
      return addMonths(date, every.n * 12)
  }
}

/**
 * The date from which an item is due for review: its last review plus its
 * frequency. Never reviewed: `today`, so it is due at once.
 */
export function nextReviewOn(item: Project | Area, today: CalendarDate): CalendarDate {
  if (item.reviewedAt === null) return today
  return addReviewEvery(dateOf(item.reviewedAt), reviewEveryOf(item))
}

/**
 * Can this item be reviewed at all: an area that is not deleted, or an open
 * project (Someday included; completed and cancelled ones are not).
 */
export function isReviewable(item: Project | Area): boolean {
  if (item.deleted) return false
  return !('status' in item) || views.isOpen(item)
}

export function isDueForReview(item: Project | Area, today: CalendarDate): boolean {
  return isReviewable(item) && nextReviewOn(item, today) <= today
}

export type ReviewEntry =
  | { kind: 'area'; item: Area; nextReviewOn: CalendarDate }
  | { kind: 'project'; item: Project; nextReviewOn: CalendarDate }

/**
 * Areas and projects in sidebar order: the projects without an area first,
 * then each area followed by its projects.
 */
function inSidebarOrder(ws: Snapshot, today: CalendarDate): ReviewEntry[] {
  const projects = ws.projects.filter(isReviewable)
  const project = (p: Project): ReviewEntry => ({
    kind: 'project',
    item: p,
    nextReviewOn: nextReviewOn(p, today),
  })
  const out: ReviewEntry[] = views.projectsOf(projects, null).map(project)
  for (const area of views.openAreas(ws.areas)) {
    out.push({ kind: 'area', item: area, nextReviewOn: nextReviewOn(area, today) })
    out.push(...views.projectsOf(projects, area.id).map(project))
  }
  return out
}

/**
 * What is due for review today, in sidebar order: the projects without an area, then each
 * area followed by its projects. Whatever came due on an earlier day is due now just the same.
 */
export function reviewQueue(ws: Snapshot, today: CalendarDate): ReviewEntry[] {
  return inSidebarOrder(ws, today).filter((e) => e.nextReviewOn <= today)
}

/**
 * The item to select once `id` is marked reviewed and leaves the queue: the
 * one after it, or the one before it when it was the last; null when nothing
 * else is due.
 */
export function selectAfterReviewed(queue: ReviewEntry[], id: string): string | null {
  const at = queue.findIndex((e) => e.item.id === id)
  if (at === -1) return queue[0]?.item.id ?? null
  return (queue[at + 1] ?? queue[at - 1])?.item.id ?? null
}

export type ReviewAge = { n: number; unit: 'day' | 'week' | 'month' | 'year' }

/** How long ago an item was last reviewed, in the largest whole unit; null when never. */
export function reviewAge(reviewedAt: string | null, today: CalendarDate): ReviewAge | null {
  if (reviewedAt === null) return null
  const days = Math.max(0, daysBetween(dateOf(reviewedAt), today))
  if (days < 7) return { n: days, unit: 'day' }
  if (days < 30) return { n: Math.floor(days / 7), unit: 'week' }
  if (days < 365) return { n: Math.floor(days / 30), unit: 'month' }
  return { n: Math.floor(days / 365), unit: 'year' }
}

/**
 * The open tasks a review item holds: a project's open tasks, or the open tasks right in an
 * area (its projects count for themselves).
 */
export function reviewOpenCount(entry: ReviewEntry, tasks: Task[]): number {
  const own =
    entry.kind === 'project'
      ? (t: Task) => t.projectId === entry.item.id
      : (t: Task) => t.projectId === null && t.areaId === entry.item.id
  let n = 0
  for (const t of tasks) {
    if (!t.deleted && t.repeat === null && t.status === 'open' && own(t)) n += 1
  }
  return n
}
