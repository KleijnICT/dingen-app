import type { Snapshot } from './actions.js'
import { addDays, addMonths, toCalendarDate } from './dates.js'
import type { Area, CalendarDate, Project, ReviewEvery } from './entities.js'
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
 * Areas and projects in sidebar order: each area followed by its projects,
 * then the projects without an area.
 */
function inSidebarOrder(ws: Snapshot, today: CalendarDate): ReviewEntry[] {
  const projects = ws.projects.filter(isReviewable)
  const project = (p: Project): ReviewEntry => ({
    kind: 'project',
    item: p,
    nextReviewOn: nextReviewOn(p, today),
  })
  const out: ReviewEntry[] = []
  for (const area of views.openAreas(ws.areas)) {
    out.push({ kind: 'area', item: area, nextReviewOn: nextReviewOn(area, today) })
    out.push(...views.projectsOf(projects, area.id).map(project))
  }
  out.push(...views.projectsOf(projects, null).map(project))
  return out
}

/**
 * What is due for review today: areas and projects whose date has come,
 * earliest date first, then in sidebar order.
 */
export function reviewQueue(ws: Snapshot, today: CalendarDate): ReviewEntry[] {
  const all = inSidebarOrder(ws, today)
  const rank = new Map(all.map((e, i) => [e.item.id, i]))
  return all
    .filter((e) => e.nextReviewOn <= today)
    .sort(
      (a, b) =>
        a.nextReviewOn.localeCompare(b.nextReviewOn) ||
        (rank.get(a.item.id) ?? 0) - (rank.get(b.item.id) ?? 0),
    )
}
