import {
  dueReviews,
  isStepDone,
  type Review,
  type ReviewKind,
  type ReviewStep,
  type ReviewStepId,
  reviewSteps,
  runningReview,
  type Snapshot,
} from '@dingen/core'

/**
 * Small, pure helpers for the review screens. The rules themselves (when a
 * review is due, its steps, what counts as done) live in `@dingen/core`; this
 * only shapes them for the web app.
 */

export const REVIEW_KINDS: ReviewKind[] = ['daily', 'weekly', 'monthly']

export const reviewPath = (kind: ReviewKind) => `/review/${kind}`

export function parseReviewKind(value: string | undefined): ReviewKind | null {
  return REVIEW_KINDS.find((k) => k === value) ?? null
}

/**
 * The sidebar dot: a weekly or monthly review is ready (or running). The daily
 * review is left out on purpose; it equals a non-empty Inbox, and the sidebar
 * already counts that.
 */
export function showReviewDot(reviews: Review[], today: string): boolean {
  return dueReviews(reviews, today).some((k) => k !== 'daily')
}

export interface BannerItem {
  kind: ReviewKind
  running: boolean
}

/** The bars on Today: one per weekly or monthly review that is ready. */
export function reviewBanners(reviews: Review[], today: string): BannerItem[] {
  return dueReviews(reviews, today)
    .filter((k) => k !== 'daily')
    .map((kind) => ({ kind, running: runningReview(reviews, kind) !== null }))
}

export interface StepState {
  step: ReviewStep
  done: boolean
}

export function stepStates(review: Review, ws: Snapshot): StepState[] {
  return reviewSteps(review.kind).map((step) => ({
    step,
    done: isStepDone(review, step, ws, ws.today),
  }))
}

/**
 * Steps still open once the person moves on from `stepId`: moving on ticks
 * off a step with one tick, nothing else. Reviews complete only when this is
 * empty (the same rule as the MCP tools, without their force option).
 */
export function openStepsAfter(states: StepState[], stepId: ReviewStepId): ReviewStepId[] {
  return states
    .filter((s) => !s.done && !(s.step.id === stepId && s.step.check === 'once'))
    .map((s) => s.step.id)
}

/** The step after `id` in this kind of review, or null after the last. */
export function stepAfter(kind: ReviewKind, id: ReviewStepId): ReviewStepId | null {
  const steps = reviewSteps(kind)
  const at = steps.findIndex((s) => s.id === id)
  return steps[at + 1]?.id ?? null
}

export function stepBefore(kind: ReviewKind, id: ReviewStepId): ReviewStepId | null {
  const steps = reviewSteps(kind)
  const at = steps.findIndex((s) => s.id === id)
  return at > 0 ? (steps[at - 1]?.id ?? null) : null
}

/** `doneSteps` with `key` added once. */
export function withDoneStep(review: Review, key: string): string[] {
  return review.doneSteps.includes(key) ? review.doneSteps : [...review.doneSteps, key]
}

/** `doneSteps` without `key`. */
export function withoutDoneStep(review: Review, key: string): string[] {
  return review.doneSteps.filter((k) => k !== key)
}

/**
 * The next item still to review: the first one after `afterId` (wrapping
 * around) that is not done. `afterId` itself never counts, so it can be
 * passed right after ticking it off, before the change shows in `isDone`.
 */
export function nextToReview<T extends { id: string }>(
  items: T[],
  isDone: (item: T) => boolean,
  afterId: string | null = null,
): T | null {
  const start = afterId === null ? 0 : items.findIndex((i) => i.id === afterId) + 1
  for (let n = 0; n < items.length; n++) {
    const item = items[(start + n) % items.length] as T
    if (item.id !== afterId && !isDone(item)) return item
  }
  return null
}
