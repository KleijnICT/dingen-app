import type { Task } from './entities.js'

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
