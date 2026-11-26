import { MAX_DURATION, type Task } from './entities.js'

/**
 * Estimated duration of a task (plan 25): whole minutes or null. Shared by the
 * row, the panel, the totals in Today, the filter and the MCP tools.
 */

/** The choices the app offers; any other value can be typed in. */
export const DURATION_CHOICES: readonly number[] = [5, 15, 30, 60, 120]

/** The steps of the duration filter: at most this many minutes. */
export const DURATION_FILTERS: readonly number[] = [5, 15, 30, 60]

/** Short form: `15m`, `1u`, `1u30` (Dutch) or `15m`, `1h`, `1h30` (English). */
export function formatDuration(minutes: number, hourUnit: 'u' | 'h' = 'h'): string {
  if (minutes < 60) return `${minutes}m`
  const hours = Math.floor(minutes / 60)
  const rest = minutes % 60
  return rest === 0 ? `${hours}${hourUnit}` : `${hours}${hourUnit}${String(rest).padStart(2, '0')}`
}

/** Sum of the estimated durations; tasks without one count as 0. */
export function totalDuration(tasks: readonly Pick<Task, 'duration'>[]): number {
  return tasks.reduce((sum, task) => sum + (task.duration ?? 0), 0)
}

/** Does the task fit in at most `max` minutes? Tasks without a duration do not. */
export function fitsDuration(task: Pick<Task, 'duration'>, max: number | null): boolean {
  if (max === null) return true
  return task.duration !== null && task.duration <= max
}

/**
 * A typed-in duration in minutes, or null when it is not one. Plain numbers are
 * minutes; `1u30`, `1h30`, `2u`, `1:30`, `45m` and `1,5u` are read too.
 */
export function parseDuration(input: string): number | null {
  const text = input.trim().toLowerCase().replace(/\s+/g, '').replace(',', '.')
  if (!text) return null
  const plain = text.match(/^(\d+)(m|min)?$/)
  const clock = text.match(/^(\d+):(\d{1,2})$/)
  const hours = text.match(/^(\d+(?:\.\d+)?)[uh](?:(\d{1,2})m?)?$/)
  const minutes = plain
    ? Number(plain[1])
    : clock
      ? Number(clock[1]) * 60 + Number(clock[2])
      : hours
        ? Number(hours[1]) * 60 + (hours[2] ? Number(hours[2]) : 0)
        : Number.NaN
  const rounded = Math.round(minutes)
  return rounded >= 1 && rounded <= MAX_DURATION ? rounded : null
}
