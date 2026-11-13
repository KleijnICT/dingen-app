import { ListRestart, X } from 'lucide-react'
import { useT } from '../i18n/index.js'
import { bannerClosedOn, closeReviewBanner, useReviewBannersClosed } from '../prefs.js'
import { reviewBanners } from '../reviewFlow.js'
import { useEngine, useWorkspace } from '../store/context.js'
import { startReview, useReviewAnchor, useReviews } from './useReviews.js'

/**
 * On Today: "Weekly Review is ready" (or monthly), with a button to start or resume it and a
 * cross that hides it until tomorrow.
 */
export function ReviewBanner() {
  const t = useT()
  const engine = useEngine()
  const ws = useWorkspace()
  const reviews = useReviews()
  const closed = useReviewBannersClosed()
  const banners = reviewBanners(reviews, ws.today, useReviewAnchor()).filter(
    ({ kind }) => !bannerClosedOn(closed, kind, ws.today),
  )
  if (banners.length === 0) return null
  return (
    <div className="review-banners">
      {banners.map(({ kind, running }) => (
        <div key={kind} className="review-banner">
          <ListRestart
            size={18}
            strokeWidth={1.8}
            className="review-banner-icon"
            aria-hidden="true"
          />
          <span className="review-banner-text">
            {t(running ? `review.banner.running.${kind}` : `review.banner.ready.${kind}`)}
          </span>
          <button
            type="button"
            className="chip small"
            onClick={() => startReview(engine, reviews, kind)}
          >
            {running ? t('review.resume') : t('review.start')}
          </button>
          <button
            type="button"
            className="review-banner-close"
            aria-label={t('review.banner.close')}
            title={t('review.banner.close')}
            onClick={() => closeReviewBanner(kind, ws.today)}
          >
            <X size={16} strokeWidth={1.8} aria-hidden="true" />
          </button>
        </div>
      ))}
    </div>
  )
}
