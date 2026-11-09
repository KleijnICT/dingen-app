import type { When } from '@dingen/core'
import { useT } from '../i18n/index.js'
import { addDays } from '../lists.js'

interface Props {
  when: When
  evening: boolean
  today: string
  onChange: (when: When, evening: boolean) => void
  /** Projects have no Inbox and no evening. */
  forProject?: boolean
}

/** The one way to plan: Inbox, Today, This Evening, Tomorrow, Anytime, Someday, or a date. */
export function WhenPicker({ when, evening, today, onChange, forProject = false }: Props) {
  const t = useT()
  const isDate = when.kind === 'date'
  const isToday = isDate && when.date <= today
  const options: { label: string; active: boolean; apply: () => void }[] = [
    ...(forProject
      ? []
      : [
          {
            label: t('when.inbox'),
            active: when.kind === 'inbox',
            apply: () => onChange({ kind: 'inbox' }, false),
          },
        ]),
    {
      label: t('when.today'),
      active: isToday && !evening,
      apply: () => onChange({ kind: 'date', date: today }, false),
    },
    ...(forProject
      ? []
      : [
          {
            label: t('when.thisEvening'),
            active: isToday && evening,
            apply: () => onChange({ kind: 'date', date: today }, true),
          },
        ]),
    {
      label: t('when.tomorrow'),
      active: isDate && when.date === addDays(today, 1),
      apply: () => onChange({ kind: 'date', date: addDays(today, 1) }, false),
    },
    {
      label: t('when.anytime'),
      active: when.kind === 'anytime',
      apply: () => onChange({ kind: 'anytime' }, false),
    },
    {
      label: t('when.someday'),
      active: when.kind === 'someday',
      apply: () => onChange({ kind: 'someday' }, false),
    },
  ]

  return (
    <fieldset className="when-picker" aria-label={t('when.label')}>
      {options.map((o) => (
        <button
          type="button"
          key={o.label}
          className={`chip ${o.active ? 'active' : ''}`}
          onClick={o.apply}
        >
          {o.label}
        </button>
      ))}
      <input
        type="date"
        className="chip date"
        value={isDate ? when.date : ''}
        min={today}
        onChange={(e) => {
          if (e.target.value) onChange({ kind: 'date', date: e.target.value }, false)
        }}
        aria-label={t('when.pickDate')}
      />
    </fieldset>
  )
}
