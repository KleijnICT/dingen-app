import { addDays } from './dates.js'
import type { CalendarDate, Reminder, Task, TimeOfDay } from './entities.js'

/**
 * Tijden en herinneringen. Een tijd en een herinnering bestaan alleen bij een
 * taak met een `when`-datum; de herinnering is relatief aan die datum.
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

/** Staat de herinnering op de tijd van de taak, op de dag zelf? Dan volgt hij die tijd. */
function followsTime(task: Task): boolean {
  return (
    task.reminder !== null &&
    task.time !== null &&
    task.reminder.daysBefore === 0 &&
    task.reminder.time === task.time
  )
}

/**
 * De veldwijzigingen voor een nieuwe tijd en/of herinnering; de ene regel voor
 * web en MCP. Een nieuwe tijd zonder expliciete herinnering zet de herinnering
 * op die tijd als er nog geen tijd en geen herinnering was, en laat een
 * herinnering die de oude tijd volgde meeschuiven (of verdwijnen met de tijd).
 * Zonder datum verandert er niets.
 */
export function scheduleFields(
  task: Task,
  input: { time?: TimeOfDay | null | undefined; reminder?: Reminder | null | undefined },
): Record<string, unknown> {
  if (task.when.kind !== 'date') return {}
  const fields: Record<string, unknown> = {}
  let reminder = task.reminder
  if (input.time !== undefined && input.time !== task.time) {
    fields.time = input.time
    if (input.reminder === undefined) {
      if (input.time === null) {
        if (followsTime(task)) reminder = null
      } else if (followsTime(task) || (task.time === null && task.reminder === null)) {
        reminder = { daysBefore: 0, time: input.time }
      }
    }
  }
  if (input.reminder !== undefined) reminder = input.reminder
  if (!sameReminder(reminder, task.reminder)) fields.reminder = reminder
  return fields
}
