import { addDays, daysBetween, type Reminder, scheduleFields, type Task } from '@dingen/core'
import { Bell, Clock } from 'lucide-react'
import { useT } from '../i18n/index.js'

interface Props {
  task: Task
  onChange: (fields: Record<string, unknown>) => void
}

/** Default time for a reminder on a task without a time. */
const DEFAULT_REMINDER_TIME = '09:00'

/**
 * Time of day and reminder of a task with a date. Setting a time also sets a
 * reminder at that time; the bell turns it off, or on again, and the reminder
 * can move to another day (up to the task's date) and time.
 */
export function ScheduleField({ task, onChange }: Props) {
  const t = useT()
  if (task.when.kind !== 'date') return null
  const date = task.when.date
  const reminder = task.reminder
  const reminderDate = reminder ? addDays(date, -reminder.daysBefore) : null

  const set = (input: { time?: string | null; reminder?: Reminder | null }) => {
    const fields = scheduleFields(task, input)
    if (Object.keys(fields).length > 0) onChange(fields)
  }

  return (
    <div className="schedule-field">
      <span className={`schedule-time ${task.time ? 'set' : ''}`}>
        <Clock size={14} className="meta-icon" aria-hidden="true" />
        <input
          type="time"
          className="chip date"
          value={task.time ?? ''}
          onChange={(e) => set({ time: e.target.value || null })}
          aria-label={t('reminder.time')}
        />
        {task.time && (
          <button
            type="button"
            className="task-delete visible"
            aria-label={t('reminder.clearTime')}
            title={t('reminder.clearTime')}
            onClick={() => set({ time: null })}
          >
            ×
          </button>
        )}
      </span>
      <span className="schedule-reminder">
        <button
          type="button"
          className={`chip reminder-toggle ${reminder ? 'active' : ''}`}
          aria-pressed={reminder !== null}
          onClick={() =>
            set({
              reminder: reminder
                ? null
                : { daysBefore: 0, time: task.time ?? DEFAULT_REMINDER_TIME },
            })
          }
        >
          <Bell size={13} aria-hidden="true" />
          {t('reminder.label')}
        </button>
        {reminder && reminderDate && (
          <>
            <input
              type="date"
              className="chip date"
              value={reminderDate}
              max={date}
              onChange={(e) => {
                const value = e.target.value
                if (!value) return
                const daysBefore = daysBetween(value, date)
                if (daysBefore < 0 || daysBefore > 365) return
                set({ reminder: { ...reminder, daysBefore } })
              }}
              aria-label={t('reminder.date')}
            />
            <input
              type="time"
              className="chip date"
              value={reminder.time}
              onChange={(e) => {
                if (e.target.value) set({ reminder: { ...reminder, time: e.target.value } })
              }}
              aria-label={t('reminder.atTime')}
            />
          </>
        )}
      </span>
    </div>
  )
}

/** Time and bell in a task row; nothing without a date. */
export function ScheduleBadge({ task }: { task: Task }) {
  const t = useT()
  if (task.when.kind !== 'date' || (task.time === null && task.reminder === null)) return null
  return (
    <span className="meta-time" title={task.reminder ? t('reminder.label') : undefined}>
      {task.reminder && <Bell size={12} aria-label={t('reminder.label')} />}
      {task.time}
    </span>
  )
}
