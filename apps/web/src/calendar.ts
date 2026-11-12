import {
  addDays,
  CALENDAR_HORIZON_DAYS,
  type CalendarEvent,
  type CalendarEventsResponse,
  type CalendarInfo,
} from '@dingen/core'
import { useEffect, useSyncExternalStore } from 'react'
import { api } from './api.js'

/**
 * Afspraken uit de agenda's van de gebruiker, alleen lezen. De server haalt de
 * feeds op; deze store vraagt vandaag plus CALENDAR_HORIZON_DAYS op, bewaart
 * het laatste antwoord per gebruiker in localStorage en faalt stil, zodat
 * Vandaag en Binnenkort offline tonen wat er het laatst was.
 */

/** Zelfde termijn als de cache op de server. */
export const CALENDAR_REFRESH_MS = 15 * 60_000
/**
 * Opnieuw vragen als de server een agenda nu niet kon leveren. Hij probeert
 * het zelf na een minuut opnieuw; zonder deze kortere termijn bleef zo'n agenda
 * (na een herstart, op een apparaat zonder cache) tot een kwartier leeg.
 */
export const CALENDAR_RETRY_MS = 70_000

export interface CalendarData {
  calendars: CalendarInfo[]
  events: CalendarEvent[]
}

const EMPTY: CalendarData = { calendars: [], events: [] }

/** Minimale opslag-interface, zodat tests geen browser nodig hebben. */
export interface KeyValueStorage {
  getItem(key: string): string | null
  setItem(key: string, value: string): void
  removeItem(key: string): void
}

export function cacheKey(userId: string): string {
  return `dingen.calendarEvents.${userId}`
}

/** Het bewaarde antwoord, of leeg als er niets (bruikbaars) is. */
export function readCache(storage: KeyValueStorage | null, userId: string): CalendarData {
  try {
    const raw = storage?.getItem(cacheKey(userId))
    if (!raw) return EMPTY
    const parsed = JSON.parse(raw) as Partial<CalendarData>
    if (!Array.isArray(parsed.calendars) || !Array.isArray(parsed.events)) return EMPTY
    return { calendars: parsed.calendars, events: parsed.events }
  } catch {
    return EMPTY
  }
}

export function writeCache(
  storage: KeyValueStorage | null,
  userId: string,
  data: CalendarData,
): void {
  try {
    if (data.calendars.length === 0) storage?.removeItem(cacheKey(userId))
    else storage?.setItem(cacheKey(userId), JSON.stringify(data))
  } catch {
    // Vol of geweigerd (privévenster): dan alleen in het geheugen.
  }
}

/**
 * Voegt een nieuw antwoord samen met wat er al was. Voor een agenda die de
 * server nu niet kon leveren (`failed`) blijven de oude afspraken staan.
 */
export function mergeResponse(previous: CalendarData, res: CalendarEventsResponse): CalendarData {
  const failed = new Set(res.failed)
  const kept = previous.events.filter((e) => failed.has(e.calendarId))
  const known = new Set(res.calendars.map((c) => c.id))
  return {
    calendars: res.calendars,
    events: [...res.events, ...kept.filter((e) => known.has(e.calendarId))],
  }
}

/** Wanneer het venster opnieuw opgehaald moet worden: eerder als er een agenda faalde. */
export function nextRefreshMs(res: Pick<CalendarEventsResponse, 'failed'>): number {
  return res.failed.length > 0 ? CALENDAR_RETRY_MS : CALENDAR_REFRESH_MS
}

export function rangeFor(today: string): { from: string; to: string } {
  return { from: today, to: addDays(today, CALENDAR_HORIZON_DAYS) }
}

function browserStorage(): KeyValueStorage | null {
  try {
    return typeof localStorage === 'undefined' ? null : localStorage
  } catch {
    return null
  }
}

let state: CalendarData = EMPTY
let owner: string | null = null
let current: { userId: string; today: string } | null = null
let retryTimer: ReturnType<typeof setTimeout> | null = null
const listeners = new Set<() => void>()

function setState(next: CalendarData): void {
  state = next
  for (const l of listeners) l()
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener)
  return () => listeners.delete(listener)
}

/** Haalt het venster opnieuw op; zonder verbinding of bij een fout blijft alles staan. */
export async function refreshCalendar(): Promise<void> {
  if (!current) return
  const { userId, today } = current
  const { from, to } = rangeFor(today)
  try {
    const res = await api.get<CalendarEventsResponse>(`/api/calendars/events?from=${from}&to=${to}`)
    if (current?.userId !== userId) return
    const next = mergeResponse(state, res)
    writeCache(browserStorage(), userId, next)
    setState(next)
    if (retryTimer) clearTimeout(retryTimer)
    retryTimer = null
    const delay = nextRefreshMs(res)
    if (delay < CALENDAR_REFRESH_MS) {
      retryTimer = setTimeout(() => {
        retryTimer = null
        void refreshCalendar()
      }, delay)
    }
  } catch {
    // Stil falen: offline of server weg; het laatst bekende blijft zichtbaar.
  }
}

/**
 * Houdt de agenda bij voor de ingelogde gebruiker: bij het starten, elke
 * CALENDAR_REFRESH_MS, bij een nieuwe dag en als het venster weer focus krijgt.
 * Eén keer aanroepen, in de Shell.
 */
export function useCalendarFeed(userId: string, today: string): void {
  useEffect(() => {
    if (owner !== userId) {
      owner = userId
      setState(readCache(browserStorage(), userId))
    }
    current = { userId, today }
    void refreshCalendar()
    const timer = setInterval(() => void refreshCalendar(), CALENDAR_REFRESH_MS)
    const onFocus = () => void refreshCalendar()
    window.addEventListener('focus', onFocus)
    window.addEventListener('online', onFocus)
    return () => {
      clearInterval(timer)
      if (retryTimer) clearTimeout(retryTimer)
      retryTimer = null
      window.removeEventListener('focus', onFocus)
      window.removeEventListener('online', onFocus)
    }
  }, [userId, today])
}

/** De laatst bekende afspraken en agenda's. */
export function useCalendarData(): CalendarData {
  return useSyncExternalStore(
    subscribe,
    () => state,
    () => EMPTY,
  )
}

/** Dagen tussen `from` en `to` (inclusief) waarop minstens één afspraak valt. */
export function daysWithEvents(events: CalendarEvent[], from: string, to: string): string[] {
  const days: string[] = []
  for (let day = from; day <= to; day = addDays(day, 1)) {
    if (events.some((e) => e.startDate <= day && e.endDate >= day)) days.push(day)
  }
  return days
}
