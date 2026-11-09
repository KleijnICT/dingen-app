import { useT } from '../i18n/index.js'
import { describeDeadline } from '../lists.js'
import { FlagIcon } from './Icons.js'

interface FieldProps {
  deadline: string | null
  today: string
  onChange: (deadline: string | null) => void
}

/** A date field with a flag; the one way to set a deadline on a task or project. */
export function DeadlineField({ deadline, today, onChange }: FieldProps) {
  const t = useT()
  return (
    <span className={`deadline-field ${deadline ? 'set' : ''}`}>
      <FlagIcon className="meta-icon" />
      <span className="deadline-label">{t('deadline.label')}</span>
      <input
        type="date"
        className="chip date"
        value={deadline ?? ''}
        onChange={(e) => onChange(e.target.value || null)}
        aria-label={t('deadline.label')}
      />
      {deadline && (
        <>
          <DeadlineBadge deadline={deadline} today={today} />
          <button
            type="button"
            className="task-delete visible"
            aria-label={t('deadline.clear')}
            title={t('deadline.clear')}
            onClick={() => onChange(null)}
          >
            ×
          </button>
        </>
      )}
    </span>
  )
}

interface BadgeProps {
  deadline: string
  today: string
}

export function DeadlineBadge({ deadline, today }: BadgeProps) {
  const { text, late } = describeDeadline(deadline, today)
  return (
    <span className={`deadline ${late ? 'late' : ''}`} title={deadline}>
      <FlagIcon />
      {text}
    </span>
  )
}
