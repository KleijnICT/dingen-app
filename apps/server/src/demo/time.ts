import type { CalendarDate } from '@dingen/core'

/** The calendar day of `now` in a time zone, as YYYY-MM-DD. */
export function todayIn(timezone: string, now: Date = new Date()): CalendarDate {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: timezone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(now)
}

/** Offset of a time zone from UTC at an instant, in milliseconds. */
function offsetMs(timezone: string, instant: number): number {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: timezone,
    hourCycle: 'h23',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  }).formatToParts(new Date(instant))
  const get = (type: string) => Number(parts.find((p) => p.type === type)?.value ?? 0)
  const asUtc = Date.UTC(
    get('year'),
    get('month') - 1,
    get('day'),
    get('hour'),
    get('minute'),
    get('second'),
  )
  return asUtc - (instant - (instant % 1000))
}

/** The instant (ISO, UTC) of a wall-clock time on a calendar day in a time zone. */
export function zonedIso(date: CalendarDate, time: string, timezone: string): string {
  const [y, m, d] = date.split('-').map(Number) as [number, number, number]
  const [hh, mm] = time.split(':').map(Number) as [number, number]
  const guess = Date.UTC(y, m - 1, d, hh, mm)
  // Twice, so a guess on the other side of a DST change still lands right.
  let instant = guess - offsetMs(timezone, guess)
  instant = guess - offsetMs(timezone, instant)
  return new Date(instant).toISOString()
}
