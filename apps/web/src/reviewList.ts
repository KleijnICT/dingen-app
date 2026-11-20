import type { CalendarDate, ReviewEntry } from '@dingen/core'

/** Due items with the same review date, under one heading in the Review list. */
export interface ReviewDateGroup {
  date: CalendarDate
  entries: ReviewEntry[]
}

/**
 * The review queue in groups per review date, in queue order. The queue is
 * already sorted by date, so each date forms one run.
 */
export function groupByReviewDate(queue: ReviewEntry[]): ReviewDateGroup[] {
  const groups: ReviewDateGroup[] = []
  for (const entry of queue) {
    const last = groups.at(-1)
    if (last && last.date === entry.nextReviewOn) last.entries.push(entry)
    else groups.push({ date: entry.nextReviewOn, entries: [entry] })
  }
  return groups
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
