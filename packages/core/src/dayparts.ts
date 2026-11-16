import { type Daypart, type Reminder, TimeOfDay } from './entities.js'

/**
 * Dayparts (plan 25). A task with a date can be planned for the morning,
 * afternoon or evening of that day; it has no exact time any more. Only a
 * reminder has an exact time, and it stands on its own.
 *
 * The boundaries are fixed: the afternoon starts at 12:00, the evening at
 * 18:00. Each daypart has a start time, which is the suggested reminder time.
 */

export const DAYPARTS: readonly Daypart[] = ['morning', 'afternoon', 'evening']

/** The afternoon starts at this time. */
export const AFTERNOON_FROM: TimeOfDay = '12:00'
/** The evening starts at this time. */
export const EVENING_FROM: TimeOfDay = '18:00'

const START: Record<Daypart, TimeOfDay> = {
  morning: '09:00',
  afternoon: '13:00',
  evening: '19:00',
}

/** The daypart a clock time falls in. `HH:MM` strings compare in time order. */
export function daypartOf(time: TimeOfDay): Daypart {
  if (time >= EVENING_FROM) return 'evening'
  if (time >= AFTERNOON_FROM) return 'afternoon'
  return 'morning'
}

/** The start of a daypart, the suggested reminder time; without a daypart 09:00. */
export function daypartStartTime(daypart: Daypart | null): TimeOfDay {
  return START[daypart ?? 'morning']
}

const isDated = (when: unknown): boolean =>
  typeof when === 'object' && when !== null && (when as { kind?: unknown }).kind === 'date'

/**
 * Task fields of sync protocol 2 (`evening`, `time`) in protocol 3 terms:
 * the one conversion for pushes from old clients, imports of old export files,
 * old MCP input and the data migration. `current` is the task's data as it
 * stands (absent for a new task). Fields without `evening` or `time` come back
 * as they are.
 *
 * - `evening: true` → daypart evening; `evening: false` clears an evening
 *   daypart (and sets none on a new task), but leaves morning and afternoon.
 * - A `time` → the daypart it falls in (unless `evening: true` says evening),
 *   and, when the task has no reminder and the fields set none, a reminder at
 *   that time on the day itself, so no notification gets lost.
 * - Without a date there is no daypart and no reminder is added.
 * - An explicit `daypart` or `reminder` in the fields wins.
 *
 * A malformed `evening` or `time` is left in, so validation rejects it.
 */
export function upgradeTaskFields(
  fields: Record<string, unknown>,
  current?: Record<string, unknown>,
): Record<string, unknown> {
  if (!('evening' in fields) && !('time' in fields)) return fields
  const { evening, time, ...out } = fields
  if (evening !== undefined && typeof evening !== 'boolean') out.evening = evening
  const parsedTime = time === null || time === undefined ? null : TimeOfDay.safeParse(time)
  if (parsedTime && !parsedTime.success) out.time = time
  const legacyTime = parsedTime?.success ? parsedTime.data : null

  const when = 'when' in fields ? fields.when : current?.when
  if (!isDated(when)) {
    if (!('daypart' in out) && (current?.daypart ?? null) !== null) out.daypart = null
    return out
  }
  if (!('daypart' in out)) {
    if (evening === true) out.daypart = 'evening'
    else if (legacyTime) out.daypart = daypartOf(legacyTime)
    else if (evening === false && (current === undefined || current.daypart === 'evening')) {
      out.daypart = null
    }
  }
  const hasReminder = 'reminder' in out || (current?.reminder ?? null) !== null
  if (legacyTime && !hasReminder) {
    out.reminder = { daysBefore: 0, time: legacyTime } satisfies Reminder
  }
  return out
}

/**
 * A task's data as a protocol 2 client expects it: `evening` derived from the
 * daypart and `time` null. `daypart` and `duration` stay; protocol 2 schemas
 * do not know them and drop them when parsing.
 */
export function downgradeTaskData(data: Record<string, unknown>): Record<string, unknown> {
  return { ...data, evening: data.daypart === 'evening', time: null }
}

/**
 * The fields of a task change as a protocol 2 client expects them: a change
 * of the daypart also sets `evening` (and `time` null).
 */
export function downgradeTaskFields(fields: Record<string, unknown>): Record<string, unknown> {
  if (!('daypart' in fields)) return fields
  return { ...fields, evening: fields.daypart === 'evening', time: null }
}
