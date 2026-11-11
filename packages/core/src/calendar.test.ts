import { describe, expect, it } from 'vitest'
import { type CalendarEvent, eventSpan, eventsOnDay } from './calendar.js'

function ev(partial: Partial<CalendarEvent> & { id: string }): CalendarEvent {
  return {
    calendarId: 'c1',
    title: partial.id,
    location: null,
    allDay: false,
    startDate: '2026-11-12',
    endDate: '2026-11-12',
    startTime: '09:00',
    endTime: '10:00',
    start: '2026-11-12T08:00:00.000Z',
    end: '2026-11-12T09:00:00.000Z',
    ...partial,
  }
}

describe('eventsOnDay', () => {
  it('zet hele dagen voor afspraken met tijd, en sorteert op tijd', () => {
    const events = [
      ev({ id: 'laat', startTime: '15:00' }),
      ev({ id: 'vroeg', startTime: '08:30' }),
      ev({ id: 'heledag', allDay: true, startTime: null, endTime: null }),
      ev({ id: 'morgen', startDate: '2026-11-13', endDate: '2026-11-13' }),
    ]
    expect(eventsOnDay(events, '2026-11-12').map((e) => e.id)).toEqual(['heledag', 'vroeg', 'laat'])
  })

  it('toont een meerdaagse afspraak op elke dag, met de juiste rol', () => {
    const trip = ev({
      id: 'reis',
      startDate: '2026-11-12',
      endDate: '2026-11-14',
      startTime: '18:00',
      endTime: '11:00',
    })
    expect(eventsOnDay([trip], '2026-11-11')).toEqual([])
    expect(eventSpan(trip, '2026-11-12')).toBe('first')
    expect(eventSpan(trip, '2026-11-13')).toBe('middle')
    expect(eventSpan(trip, '2026-11-14')).toBe('last')
    expect(eventsOnDay([trip], '2026-11-14')).toHaveLength(1)
  })
})
