import type { CalendarDate } from './entities.js'

/**
 * Rekenen met kalenderdatums (YYYY-MM-DD) zonder tijdzone. Alle functies zijn
 * puur; clients en server delen ze zodat "volgende maandag" overal hetzelfde is.
 */

export function parseCalendarDate(date: CalendarDate): Date {
  const [y, m, d] = date.split('-').map(Number) as [number, number, number]
  return new Date(y, m - 1, d)
}

/** Kalenderdatum van een tijdstip in de lokale tijdzone van de aanroeper. */
export function toCalendarDate(d: Date = new Date()): CalendarDate {
  const y = d.getFullYear()
  const m = String(d.getMonth() + 1).padStart(2, '0')
  const day = String(d.getDate()).padStart(2, '0')
  return `${y}-${m}-${day}`
}

export function addDays(date: CalendarDate, days: number): CalendarDate {
  const base = parseCalendarDate(date)
  return toCalendarDate(new Date(base.getFullYear(), base.getMonth(), base.getDate() + days))
}

/** Zelfde dag van de maand, ingekort als die maand korter is (31 jan + 1 = 28 feb). */
export function addMonths(date: CalendarDate, months: number, dayOfMonth?: number): CalendarDate {
  const base = parseCalendarDate(date)
  const wanted = dayOfMonth ?? base.getDate()
  const first = new Date(base.getFullYear(), base.getMonth() + months, 1)
  const last = new Date(first.getFullYear(), first.getMonth() + 1, 0).getDate()
  return toCalendarDate(new Date(first.getFullYear(), first.getMonth(), Math.min(wanted, last)))
}

export function addYears(date: CalendarDate, years: number, dayOfMonth?: number): CalendarDate {
  return addMonths(date, years * 12, dayOfMonth)
}

/** 0 = zondag … 6 = zaterdag, zoals `Date.getDay`. */
export function weekdayOf(date: CalendarDate): number {
  return parseCalendarDate(date).getDay()
}

export function dayOfMonth(date: CalendarDate): number {
  return parseCalendarDate(date).getDate()
}

/** Hele dagen van `from` tot `to`; negatief als `to` eerder ligt. */
export function daysBetween(from: CalendarDate, to: CalendarDate): number {
  const a = parseCalendarDate(from)
  const b = parseCalendarDate(to)
  return Math.round((b.getTime() - a.getTime()) / 86_400_000)
}
