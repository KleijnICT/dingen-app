import type { ReviewEntry } from '@dingen/core'

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
