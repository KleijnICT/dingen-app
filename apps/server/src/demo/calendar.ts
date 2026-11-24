import { addDays, type CalendarDate } from '@dingen/core'
import { type FetchFeed, httpFetchFeed } from '../calendar/service.js'
import { todayIn } from './time.js'

/**
 * The demo's calendars. Their feeds are not fetched over the network: in demo mode the
 * server writes them itself, with appointments relative to today, so the demo always shows
 * a filled week. The host is under `.invalid`, which never resolves.
 */
export const DEMO_FEED_HOST = 'demo.dingen.invalid'

interface DemoEvent {
  /** Days from today. */
  day: number
  title: string
  /** "HH:MM" to "HH:MM"; without them the appointment lasts all day. */
  start?: string
  end?: string
  location?: string
}

export interface DemoCalendar {
  key: string
  name: string
  color: string
  /** Title of Sam's area the calendar belongs to. */
  area: string
  events: DemoEvent[]
}

export const DEMO_CALENDARS: DemoCalendar[] = [
  {
    key: 'work',
    name: 'Work',
    color: 'blue',
    area: 'Clients',
    events: [
      { day: 0, title: 'Stand-up with Fieldnote', start: '09:30', end: '09:45' },
      {
        day: 0,
        title: 'Design review: Crumb & Co.',
        start: '14:00',
        end: '15:00',
        location: 'Video call',
      },
      { day: 1, title: 'Stand-up with Fieldnote', start: '09:30', end: '09:45' },
      { day: 2, title: 'Lunch with Priya', start: '12:30', end: '13:30', location: 'Café Nord' },
      { day: 4, title: 'Fieldnote onboarding workshop', start: '10:00', end: '12:00' },
      { day: 7, title: 'Crumb & Co. launch day' },
    ],
  },
  {
    key: 'family',
    name: 'Family',
    color: 'purple',
    area: 'Friends & Family',
    events: [
      { day: 0, title: 'Dinner at Mum’s', start: '18:30', end: '20:30' },
      { day: 3, title: 'Morgan’s birthday' },
      { day: 5, title: 'Football practice', start: '17:00', end: '18:00', location: 'Sports park' },
      { day: 9, title: 'Weekend in Lisbon' },
      { day: 10, title: 'Weekend in Lisbon' },
    ],
  },
]

export const demoFeedUrl = (key: string) => `https://${DEMO_FEED_HOST}/${key}.ics`

const compact = (date: CalendarDate) => date.replaceAll('-', '')
const escapeText = (text: string) => text.replace(/[;,]/g, (c) => `\\${c}`)

/** The ICS text of a demo calendar, with its appointments relative to `today`. */
export function demoFeed(calendar: DemoCalendar, today: CalendarDate, timezone: string): string {
  const lines = ['BEGIN:VCALENDAR', 'VERSION:2.0', 'PRODID:-//Dingen//Demo//EN']
  calendar.events.forEach((event, i) => {
    const date = addDays(today, event.day)
    lines.push(
      'BEGIN:VEVENT',
      `UID:demo-${calendar.key}-${i}@${DEMO_FEED_HOST}`,
      `DTSTAMP:${compact(today)}T000000Z`,
    )
    if (event.start && event.end) {
      lines.push(
        `DTSTART;TZID=${timezone}:${compact(date)}T${event.start.replace(':', '')}00`,
        `DTEND;TZID=${timezone}:${compact(date)}T${event.end.replace(':', '')}00`,
      )
    } else {
      lines.push(
        `DTSTART;VALUE=DATE:${compact(date)}`,
        `DTEND;VALUE=DATE:${compact(addDays(date, 1))}`,
      )
    }
    lines.push(`SUMMARY:${escapeText(event.title)}`)
    if (event.location) lines.push(`LOCATION:${escapeText(event.location)}`)
    lines.push('END:VEVENT')
  })
  lines.push('END:VCALENDAR', '')
  return lines.join('\r\n')
}

/**
 * The feed fetcher for demo mode: the demo calendars come from `demoFeed`, written for the
 * day of the request; every other address is fetched as usual.
 */
export function demoFetchFeed(
  timezone: string,
  now: () => Date = () => new Date(),
  fallback: FetchFeed = httpFetchFeed,
): FetchFeed {
  return async (raw) => {
    const url = new URL(raw)
    const calendar =
      url.host === DEMO_FEED_HOST
        ? DEMO_CALENDARS.find((c) => url.pathname === `/${c.key}.ics`)
        : undefined
    return calendar ? demoFeed(calendar, todayIn(timezone, now()), timezone) : fallback(raw)
  }
}
