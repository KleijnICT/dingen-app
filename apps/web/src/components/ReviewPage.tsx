import {
  currentStep,
  lastCompletedReview,
  nextReviewDate,
  type Review,
  type ReviewKind,
  type ReviewStepId,
  reviewSteps,
  runningReview,
} from '@dingen/core'
import { Check } from 'lucide-react'
import { useState } from 'react'
import { formatDate, type MessageKey, useT } from '../i18n/index.js'
import { describeDate } from '../lists.js'
import { REVIEW_KINDS, stepAfter, stepBefore, stepStates, withDoneStep } from '../reviewFlow.js'
import { navigate } from '../router.js'
import { useEngine, useWorkspace } from '../store/context.js'
import { ReviewStepView } from './ReviewSteps.js'
import { startReview, useReviews } from './useReviews.js'

interface Props {
  /** The review to show; null shows the overview. */
  kind: ReviewKind | null
}

/** Route /review: the overview, or the running review of one kind. */
export function ReviewPage({ kind }: Props) {
  const reviews = useReviews()
  const running = kind ? runningReview(reviews, kind) : null
  if (running) return <ReviewRunner key={running.id} review={running} />
  return <ReviewOverview reviews={reviews} />
}

function ReviewOverview({ reviews }: { reviews: Review[] }) {
  const t = useT()
  const engine = useEngine()
  const ws = useWorkspace()

  return (
    <section className="list-page review-page">
      <header className="list-header">
        <h1>{t('review.title')}</h1>
        <p className="muted">{t('review.intro')}</p>
      </header>
      <ul className="review-kinds">
        {REVIEW_KINDS.map((kind) => {
          const running = runningReview(reviews, kind)
          const next = nextReviewDate(reviews, kind)
          const last = lastCompletedReview(reviews, kind)
          const ready = running !== null || next === null || next <= ws.today
          let status: string
          if (running) {
            const states = stepStates(running, ws)
            const at = currentStep(running, ws, ws.today)
            const n = at ? states.findIndex((s) => s.step.id === at.id) + 1 : states.length
            status = t('review.status.running', { n, total: states.length })
          } else if (ready) status = t('review.status.ready')
          else status = t('review.status.next', { date: describeDate(next as string, ws.today) })
          return (
            <li key={kind} className={`review-kind ${ready ? 'ready' : ''}`}>
              <div className="review-kind-text">
                <h2>{t(`review.kind.${kind}`)}</h2>
                <p className="muted">{t(`review.kind.${kind}.about`)}</p>
                <p className="review-kind-status">
                  {ready && <span className="review-dot" aria-hidden="true" />}
                  {status}
                  {last?.completedAt && (
                    <span className="muted">
                      {' · '}
                      {t('review.status.last', {
                        date: formatDate(new Date(last.completedAt), { dateStyle: 'medium' }),
                      })}
                    </span>
                  )}
                </p>
              </div>
              <button
                type="button"
                className={ready ? '' : 'secondary'}
                onClick={() => startReview(engine, reviews, kind)}
              >
                {running ? t('review.resume') : ready ? t('review.start') : t('review.startAnyway')}
              </button>
            </li>
          )
        })}
      </ul>
    </section>
  )
}

function ReviewRunner({ review }: { review: Review }) {
  const t = useT()
  const engine = useEngine()
  const ws = useWorkspace()
  const steps = reviewSteps(review.kind)
  const states = stepStates(review, ws)
  // Open on the first step not done yet; after that the person moves on.
  const [stepId, setStepId] = useState<ReviewStepId>(
    () => currentStep(review, ws, ws.today)?.id ?? (steps.at(-1)?.id as ReviewStepId),
  )
  const index = steps.findIndex((s) => s.id === stepId)
  const step = steps[index] ?? steps[0]
  if (!step) return null
  const doneCount = states.filter((s) => s.done).length
  const last = stepAfter(review.kind, step.id) === null
  const previous = stepBefore(review.kind, step.id)

  function goTo(id: ReviewStepId) {
    setStepId(id)
    document.querySelector('.content')?.scrollTo({ top: 0 })
  }

  function complete() {
    engine.mutate('review', review.id, { completedAt: new Date().toISOString() })
    navigate('/review')
  }

  function next() {
    // A step with one tick is done by moving on; the others are done by their items.
    if (step?.check === 'once') {
      engine.mutate('review', review.id, { doneSteps: withDoneStep(review, step.id) })
    }
    const after = step ? stepAfter(review.kind, step.id) : null
    if (after) goTo(after)
    else complete()
  }

  return (
    <section className={`list-page review-page review-${review.kind}`}>
      <header className="list-header review-header">
        <p className="review-eyebrow">
          <button type="button" className="link" onClick={() => navigate('/review')}>
            {t('review.title')}
          </button>
          {' · '}
          {t(`review.kind.${review.kind}`)}
        </p>
        <h1>{t(`review.step.${step.id}` as MessageKey)}</h1>
        <p className="muted">{t(`review.step.${step.id}.intro` as MessageKey)}</p>
        {steps.length > 1 && (
          <>
            <div
              className="review-progress"
              role="progressbar"
              aria-valuemin={0}
              aria-valuemax={steps.length}
              aria-valuenow={doneCount}
              aria-label={t('review.progress', { n: doneCount, total: steps.length })}
            >
              <span
                className="review-progress-bar"
                style={{ width: `${(doneCount / steps.length) * 100}%` }}
              />
            </div>
            <ol className="review-steps" aria-label={t('review.steps')}>
              {states.map(({ step: s, done }, i) => (
                <li key={s.id}>
                  <button
                    type="button"
                    className={`review-step ${s.id === step.id ? 'current' : ''} ${done ? 'done' : ''}`}
                    aria-current={s.id === step.id ? 'step' : undefined}
                    title={t(`review.step.${s.id}` as MessageKey)}
                    onClick={() => goTo(s.id)}
                  >
                    {done ? <Check size={12} strokeWidth={3} aria-hidden="true" /> : i + 1}
                    <span className="visually-hidden">
                      {t(`review.step.${s.id}` as MessageKey)}
                    </span>
                  </button>
                </li>
              ))}
            </ol>
          </>
        )}
      </header>
      <ReviewStepView key={step.id} review={review} stepId={step.id} />
      <footer className="review-foot">
        {previous ? (
          <button type="button" className="link" onClick={() => goTo(previous)}>
            {t('review.previous')}
          </button>
        ) : (
          <span />
        )}
        <span className="muted review-foot-count">
          {t('review.stepOf', { n: index + 1, total: steps.length })}
        </span>
        <button type="button" onClick={next}>
          {last ? t('review.complete') : t('review.next')}
        </button>
      </footer>
    </section>
  )
}
