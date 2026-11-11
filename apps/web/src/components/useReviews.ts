import { newReview, type Review, type ReviewKind, runningReview } from '@dingen/core'
import { reviewPath } from '../reviewFlow.js'
import { navigate } from '../router.js'
import { useEngine, useEngineVersion } from '../store/context.js'
import type { SyncEngine } from '../store/engine.js'

/** All live reviews in the replica; re-renders when they change. */
export function useReviews(): Review[] {
  const engine = useEngine()
  useEngineVersion()
  return engine.entities('review') as Review[]
}

/** Opens the running review of this kind, or starts a new one first. */
export function startReview(engine: SyncEngine, reviews: Review[], kind: ReviewKind): void {
  if (runningReview(reviews, kind) === null) engine.create('review', newReview({ kind }))
  navigate(reviewPath(kind))
}
