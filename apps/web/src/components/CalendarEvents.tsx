import { type CalendarEvent, eventSpan, eventsOnDay } from '@dingen/core'
import { useCalendarData } from '../calendar.js'
import { useT } from '../i18n/index.js'
import { areaColorVar } from './AreaIcons.js'

/**
 * De afspraken van één dag, compact boven de taken: hele dagen eerst, dan op
 * tijd. Alleen lezen; niets is aan te klikken. Geen afspraken, geen blok.
 */
export function DayEvents({ date }: { date: string }) {
  const t = useT()
  const { calendars, events } = useCalendarData()
  const day = eventsOnDay(events, date)
  if (day.length === 0) return null
  const colorOf = new Map(calendars.map((c) => [c.id, c.color]))
  const nameOf = new Map(calendars.map((c) => [c.id, c.name]))

  function timeLabel(e: CalendarEvent): string {
    switch (eventSpan(e, date)) {
      case 'allDay':
      case 'middle':
        return t('calendar.allDay')
      case 'first':
        return `${e.startTime} →`
      case 'last':
        return `→ ${e.endTime}`
      case 'single':
        return e.startTime === e.endTime ? (e.startTime ?? '') : `${e.startTime}–${e.endTime}`
    }
  }

  return (
    <ul className="calendar-events" aria-label={t('calendar.events')}>
      {day.map((e) => (
        <li key={e.id} className="calendar-event" title={nameOf.get(e.calendarId) ?? undefined}>
          <span
            className="calendar-dot"
            style={{ background: areaColorVar(colorOf.get(e.calendarId) ?? null) }}
            aria-hidden="true"
          />
          <span className="calendar-time">{timeLabel(e)}</span>
          <span className="calendar-title">{e.title || t('calendar.untitled')}</span>
          {e.location && <span className="calendar-location">{e.location}</span>}
        </li>
      ))}
    </ul>
  )
}
