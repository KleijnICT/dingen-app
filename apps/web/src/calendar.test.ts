import type { CalendarEvent, CalendarEventsResponse } from '@dingen/core'
import { describe, expect, it } from 'vitest'
import {
  CALENDAR_REFRESH_MS,
  CALENDAR_RETRY_MS,
  cacheKey,
  daysWithEvents,
  type KeyValueStorage,
  mergeResponse,
  nextRefreshMs,
  rangeFor,
  readCache,
  writeCache,
} from './calendar.js'
import { nextColor } from './components/CalendarSettings.js'

function memoryStorage(): KeyValueStorage & { data: Map<string, string> } {
  const data = new Map<string, string>()
  return {
    data,
    getItem: (k) => data.get(k) ?? null,
    setItem: (k, v) => void data.set(k, v),
    removeItem: (k) => void data.delete(k),
  }
}

function ev(id: string, calendarId: string, startDate: string, endDate = startDate): CalendarEvent {
  return {
    id,
    calendarId,
    title: id,
    location: null,
    allDay: true,
    startDate,
    endDate,
    startTime: null,
    endTime: null,
    start: `${startDate}T00:00:00.000Z`,
    end: `${endDate}T00:00:00.000Z`,
  }
}

function response(partial: Partial<CalendarEventsResponse>): CalendarEventsResponse {
  return { timezone: 'Europe/Amsterdam', calendars: [], events: [], failed: [], ...partial }
}

describe('agenda-cache', () => {
  it('bewaart per gebruiker en leest het terug', () => {
    const storage = memoryStorage()
    const data = {
      calendars: [{ id: 'c1', name: 'Werk', color: 'blue' }],
      events: [ev('a', 'c1', '2026-11-12')],
    }
    writeCache(storage, 'u1', data)
    expect(readCache(storage, 'u1')).toEqual(data)
    expect(readCache(storage, 'u2')).toEqual({ calendars: [], events: [] })
    expect([...storage.data.keys()]).toEqual([cacheKey('u1')])
  })

  it('ruimt op zonder agenda’s en overleeft rommel of geen opslag', () => {
    const storage = memoryStorage()
    writeCache(storage, 'u1', { calendars: [{ id: 'c1', name: 'W', color: null }], events: [] })
    writeCache(storage, 'u1', { calendars: [], events: [] })
    expect(storage.data.size).toBe(0)
    storage.setItem(cacheKey('u1'), '{kapot')
    expect(readCache(storage, 'u1').events).toEqual([])
    expect(readCache(null, 'u1').events).toEqual([])
    const throwing: KeyValueStorage = {
      getItem: () => {
        throw new Error('geweigerd')
      },
      setItem: () => {
        throw new Error('vol')
      },
      removeItem: () => {},
    }
    expect(readCache(throwing, 'u1').events).toEqual([])
    expect(() =>
      writeCache(throwing, 'u1', { calendars: [{ id: 'c', name: 'c', color: null }], events: [] }),
    ).not.toThrow()
  })
})

describe('mergeResponse', () => {
  it('neemt het nieuwe antwoord over maar houdt oude afspraken van agenda’s die nu falen', () => {
    const previous = {
      calendars: [],
      events: [
        ev('oud-a', 'a', '2026-11-12'),
        ev('oud-b', 'b', '2026-11-12'),
        ev('weg', 'c', '2026-11-12'),
      ],
    }
    const merged = mergeResponse(
      previous,
      response({
        calendars: [
          { id: 'a', name: 'A', color: null },
          { id: 'b', name: 'B', color: null },
        ],
        events: [ev('nieuw-a', 'a', '2026-11-13')],
        failed: ['b', 'c'],
      }),
    )
    // c is verwijderd (niet meer in calendars), b faalt tijdelijk.
    expect(merged.events.map((e) => e.id)).toEqual(['nieuw-a', 'oud-b'])
  })

  it('vraagt een falende agenda na een minuut opnieuw in plaats van na een kwartier', () => {
    // Na een herstart van de server faalt de eerste keer ophalen soms; zonder
    // cache op dit apparaat bleef de agenda dan een kwartier leeg.
    const failedOnce = response({ calendars: [{ id: 'b', name: 'B', color: null }], failed: ['b'] })
    const empty = mergeResponse({ calendars: [], events: [] }, failedOnce)
    expect(empty.events).toEqual([])
    expect(nextRefreshMs(failedOnce)).toBe(CALENDAR_RETRY_MS)
    expect(CALENDAR_RETRY_MS).toBeLessThan(CALENDAR_REFRESH_MS)

    const recovered = response({
      calendars: [{ id: 'b', name: 'B', color: null }],
      events: [ev('b1', 'b', '2026-11-12')],
    })
    expect(mergeResponse(empty, recovered).events.map((e) => e.id)).toEqual(['b1'])
    expect(nextRefreshMs(recovered)).toBe(CALENDAR_REFRESH_MS)
  })
})

describe('vensters en dagen', () => {
  it('vraagt vandaag plus veertien dagen op', () => {
    expect(rangeFor('2026-11-12')).toEqual({ from: '2026-11-12', to: '2026-11-26' })
  })

  it('vindt de dagen met afspraken, ook binnen een meerdaagse', () => {
    const events = [ev('reis', 'a', '2026-11-10', '2026-11-13'), ev('los', 'a', '2026-11-20')]
    expect(daysWithEvents(events, '2026-11-12', '2026-11-21')).toEqual([
      '2026-11-12',
      '2026-11-13',
      '2026-11-20',
    ])
  })

  it('geeft een nieuwe agenda een kleur die nog niet gebruikt is', () => {
    expect(nextColor([])).toBe('blue')
    expect(nextColor(['blue', null])).toBe('green')
    expect(nextColor(['blue', 'green', 'orange', 'purple', 'red', 'mint', 'pink'])).toBe('gray')
  })
})
