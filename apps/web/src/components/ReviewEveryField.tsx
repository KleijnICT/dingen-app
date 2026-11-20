import {
  type Area,
  DEFAULT_REVIEW_EVERY,
  nextReviewOn,
  type Project,
  type ReviewEvery,
  reviewEveryOf,
} from '@dingen/core'
import { useState } from 'react'
import { useT } from '../i18n/index.js'
import { describeDate } from '../lists.js'
import { useEngine, useWorkspace } from '../store/context.js'

const UNITS = ['day', 'week', 'month', 'year'] as const

interface Props {
  kind: 'project' | 'area'
  item: Project | Area
}

/**
 * "Review every N days/weeks/months/years" for a project or area, in its `…` menu.
 * Changes are saved at once; the default (every week) is stored as null.
 */
export function ReviewEveryField({ kind, item }: Props) {
  const t = useT()
  const engine = useEngine()
  const ws = useWorkspace()
  const every = reviewEveryOf(item)
  // The number as typed, so the field may be empty for a moment.
  const [typed, setTyped] = useState(String(every.n))

  function save(next: ReviewEvery | null) {
    const isDefault =
      next !== null && next.n === DEFAULT_REVIEW_EVERY.n && next.unit === DEFAULT_REVIEW_EVERY.unit
    engine.mutate(kind, item.id, { reviewEvery: isDefault ? null : next })
  }

  return (
    <div className="review-every">
      <label className="repeat-line">
        {t('review.every')}
        <input
          type="number"
          min={1}
          max={999}
          className="repeat-number"
          value={typed}
          onChange={(e) => {
            setTyped(e.target.value)
            const n = Math.trunc(Number(e.target.value))
            if (n >= 1 && n <= 999) save({ n, unit: every.unit })
          }}
          onBlur={() => setTyped(String(reviewEveryOf(item).n))}
        />
        <select
          value={every.unit}
          onChange={(e) => save({ n: every.n, unit: e.target.value as ReviewEvery['unit'] })}
        >
          {UNITS.map((unit) => (
            <option key={unit} value={unit}>
              {t(`repeat.unit.${unit}`)}
            </option>
          ))}
        </select>
      </label>
      <p className="muted review-every-next">
        {t('review.every.next', { date: describeDate(nextReviewOn(item, ws.today), ws.today) })}
      </p>
      {item.reviewEvery !== null && (
        <button
          type="button"
          className="link"
          onClick={() => {
            save(null)
            setTyped('1')
          }}
        >
          {t('review.every.default')}
        </button>
      )}
    </div>
  )
}
