import { addDays } from './dates.js'
import type { CalendarDate, Reminder, Task, TimeOfDay } from './entities.js'

/**
 * Herinneringen. Een herinnering bestaat alleen bij een taak met een
 * `when`-datum; hij is relatief aan die datum.
 */

/** Het moment van de herinnering als kloktijd, of null als er niets te herinneren valt. */
export function reminderMoment(task: Task): { date: CalendarDate; time: TimeOfDay } | null {
  if (task.deleted || task.status !== 'open' || task.repeat !== null) return null
  if (task.when.kind !== 'date' || task.reminder === null) return null
  return { date: addDays(task.when.date, -task.reminder.daysBefore), time: task.reminder.time }
}

export function sameReminder(a: Reminder | null, b: Reminder | null): boolean {
  if (a === null || b === null) return a === b
  return a.daysBefore === b.daysBefore && a.time === b.time
}

/**
 * The field change for a new reminder; empty when it is the same or the task
 * has no date. A reminder stands on its own: it does not follow the daypart.
 */
export function reminderFields(task: Task, reminder: Reminder | null): Record<string, unknown> {
  if (task.when.kind !== 'date' || sameReminder(reminder, task.reminder)) return {}
  return { reminder }
}
