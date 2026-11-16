import { DAYPARTS, type Daypart, type When } from '@dingen/core'
import { whenOptions } from '../dayparts.js'
import { useT } from '../i18n/index.js'

interface Props {
  when: When
  daypart: Daypart | null
  today: string
  /**
   * A choice. `close` is false after a date, so a daypart can still be picked
   * underneath; a daypart or anything without a date closes the picker.
   */
  onChange: (when: When, daypart: Daypart | null, close: boolean) => void
  /** Projects have no Inbox and no daypart. */
  forProject?: boolean
}

/**
 * The one way to plan: Inbox, Today, Tomorrow, Next week, Anytime, Someday or
 * a date, and under a date the daypart (none, morning, afternoon, evening).
 * Moving to a date keeps the daypart; without a date there is none.
 */
export function WhenPicker({ when, daypart, today, onChange, forProject = false }: Props) {
  const t = useT()
  const date = when.kind === 'date' ? when.date : null

  return (
    <div className="when-picker-wrap">
      <fieldset className="when-picker" aria-label={t('when.label')}>
        {whenOptions(when, today, forProject).map((o) => (
          <button
            type="button"
            key={o.key}
            className={`chip ${o.active ? 'active' : ''}`}
            aria-pressed={o.active}
            onClick={() => onChange(o.when, o.when.kind === 'date' ? daypart : null, o.close)}
          >
            {t(`when.${o.key}`)}
          </button>
        ))}
        <input
          type="date"
          className="chip date"
          value={date ?? ''}
          min={today}
          onChange={(e) => {
            if (e.target.value)
              onChange({ kind: 'date', date: e.target.value }, daypart, forProject)
          }}
          aria-label={t('when.pickDate')}
        />
      </fieldset>
      {date !== null && !forProject && (
        <fieldset className="daypart-picker" aria-label={t('daypart.label')}>
          {[null, ...DAYPARTS].map((part) => (
            <button
              type="button"
              key={part ?? 'none'}
              className={`chip small ${daypart === part ? 'active' : ''}`}
              aria-pressed={daypart === part}
              onClick={() => onChange(when, part, true)}
            >
              {t(`daypart.${part ?? 'none'}`)}
            </button>
          ))}
        </fieldset>
      )}
    </div>
  )
}
