import type { When } from '@dingen/core'
import { addDays } from '../lists.js'

interface Props {
  when: When
  evening: boolean
  today: string
  onChange: (when: When, evening: boolean) => void
}

/** De enige manier om te plannen: Inbox, Vandaag, Vanavond, Morgen, Ooit, of een datum. */
export function WhenPicker({ when, evening, today, onChange }: Props) {
  const isDate = when.kind === 'date'
  const isToday = isDate && when.date <= today
  const options: { label: string; active: boolean; apply: () => void }[] = [
    {
      label: 'Inbox',
      active: when.kind === 'inbox',
      apply: () => onChange({ kind: 'inbox' }, false),
    },
    {
      label: 'Vandaag',
      active: isToday && !evening,
      apply: () => onChange({ kind: 'date', date: today }, false),
    },
    {
      label: 'Vanavond',
      active: isToday && evening,
      apply: () => onChange({ kind: 'date', date: today }, true),
    },
    {
      label: 'Morgen',
      active: isDate && when.date === addDays(today, 1),
      apply: () => onChange({ kind: 'date', date: addDays(today, 1) }, false),
    },
    {
      label: 'Ooit',
      active: when.kind === 'someday',
      apply: () => onChange({ kind: 'someday' }, false),
    },
  ]

  return (
    <fieldset className="when-picker" aria-label="Wanneer">
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
        aria-label="Kies een datum"
      />
    </fieldset>
  )
}
