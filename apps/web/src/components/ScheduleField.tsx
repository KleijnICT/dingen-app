import {
  addDays,
  daypartStartTime,
  daysBetween,
  type Reminder,
  reminderFields,
  type Task,
} from '@dingen/core'
import { Bell } from 'lucide-react'
import { useT } from '../i18n/index.js'

interface Props {
  task: Task
  onChange: (fields: Record<string, unknown>) => void
}

/**
 * The reminder of a task with a date. The bell turns it on (at the start of
 * the task's daypart) or off, and the reminder can move to another day (up to
 * the task's date) and time. It does not follow the daypart.
 */
export function ScheduleField({ task, onChange }: Props) {
  const t = useT()
  if (task.when.kind !== 'date') return null
  const date = task.when.date
  const reminder = task.reminder
  const reminderDate = reminder ? addDays(date, -reminder.daysBefore) : null

  const set = (input: { reminder: Reminder | null }) => {
    const fields = reminderFields(task, input.reminder)
    if (Object.keys(fields).length > 0) onChange(fields)
  }

  return (
    <div className="schedule-field">
      <span className="schedule-reminder">
        <button
          type="button"
          className={`chip reminder-toggle ${reminder ? 'active' : ''}`}
          aria-pressed={reminder !== null}
          onClick={() =>
            set({
              reminder: reminder ? null : { daysBefore: 0, time: daypartStartTime(task.daypart) },
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

/** The bell and the reminder time in a task row; nothing without a date or reminder. */
export function ScheduleBadge({ task }: { task: Task }) {
  const t = useT()
  if (task.when.kind !== 'date' || task.reminder === null) return null
  return (
    <span className="meta-time" title={t('reminder.label')}>
      <Bell size={12} aria-label={t('reminder.label')} />
      {task.reminder.time}
    </span>
  )
}
