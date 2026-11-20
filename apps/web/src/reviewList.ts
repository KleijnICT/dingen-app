import { type CalendarDate, dateOf, daysBetween, type ReviewEntry, type Task } from '@dingen/core'

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
export function openCount(entry: ReviewEntry, tasks: Task[]): number {
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
