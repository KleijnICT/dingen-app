import {
  type CalendarDate,
  newReview,
  type Review,
  type ReviewKind,
  runningReview,
} from '@dingen/core'
import { createContext, useContext } from 'react'
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

/**
 * The calendar date the account was created: a weekly or monthly review that
 * was never done counts from here, so a new account is not "ready" at once.
 * Null (no provider) falls back to "due at once".
 */
export const ReviewAnchorContext = createContext<CalendarDate | null>(null)

export function useReviewAnchor(): CalendarDate | null {
  return useContext(ReviewAnchorContext)
}

/** Opens the running review of this kind, or starts a new one first. */
export function startReview(engine: SyncEngine, reviews: Review[], kind: ReviewKind): void {
  if (runningReview(reviews, kind) === null) engine.create('review', newReview({ kind }))
  navigate(reviewPath(kind))
}
