import type { CalendarDate } from './entities.js'

/**
 * Afspraken uit een agenda (alleen lezen). De server haalt de feeds op en
 * rekent herhalingen en tijdzones uit; clients tonen alleen wat hij levert.
 */

/** Hoe ver vooruit clients afspraken ophalen en tonen, naast vandaag. */
export const CALENDAR_HORIZON_DAYS = 14

export interface CalendarEvent {
  /** Uniek per voorkomen: agenda, UID en begin. */
  id: string
  calendarId: string
  title: string
  location: string | null
  allDay: boolean
  /** Eerste dag in DINGEN_TIMEZONE. */
  startDate: CalendarDate
  /** Laatste dag in DINGEN_TIMEZONE, inclusief. */
  endDate: CalendarDate
  /** "HH:MM" in DINGEN_TIMEZONE; null bij een hele-dag-afspraak. */
  startTime: string | null
  endTime: string | null
  /** ISO-tijdstippen; bij een hele dag middernacht UTC van begin en (exclusief) einde. */
  start: string
  end: string
}

export interface CalendarInfo {
  id: string
  name: string
  color: string | null
}

/** Antwoord van `GET /api/calendars/events`. */
export interface CalendarEventsResponse {
  timezone: string
  calendars: CalendarInfo[]
  events: CalendarEvent[]
  /** Agenda's waarvan nu geen afspraken te leveren zijn. */
  failed: string[]
}

/** Hoe een afspraak op een bepaalde dag getoond wordt. */
export type EventSpan = 'allDay' | 'single' | 'first' | 'middle' | 'last'

export function eventSpan(event: CalendarEvent, date: CalendarDate): EventSpan {
  if (event.allDay) return 'allDay'
  if (event.startDate === event.endDate) return 'single'
  if (date === event.startDate) return 'first'
  if (date === event.endDate) return 'last'
  return 'middle'
}

/**
 * De afspraken op een dag: eerst hele dagen (en de middendagen van
 * meerdaagse afspraken), dan op tijd.
 */
export function eventsOnDay(events: CalendarEvent[], date: CalendarDate): CalendarEvent[] {
  const timeOn = (e: CalendarEvent): string => {
    const span = eventSpan(e, date)
    if (span === 'allDay' || span === 'middle') return ''
    if (span === 'last') return '00:00'
    return e.startTime ?? ''
  }
  return events
    .filter((e) => e.startDate <= date && e.endDate >= date)
    .sort(
      (a, b) =>
        timeOn(a).localeCompare(timeOn(b)) ||
        a.title.localeCompare(b.title) ||
        a.id.localeCompare(b.id),
    )
}
