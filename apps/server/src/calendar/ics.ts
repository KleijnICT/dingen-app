import type { CalendarDate, CalendarEvent } from '@dingen/core'
import ICAL from 'ical.js'

/**
 * ICS-feeds lezen en afspraken in een datumvenster uitrekenen. Puur: geen
 * netwerk en geen database. Herhalingen (RRULE, RDATE, EXDATE) en
 * uitzonderingen (RECURRENCE-ID) komen uit ical.js; tijdzones rekenen we zelf
 * om, zodat een IANA-zone ook zonder VTIMEZONE in de feed klopt.
 */

type IcalEvent = InstanceType<typeof ICAL.Event>
type IcalTime = InstanceType<typeof ICAL.Time>
type IcalComponent = InstanceType<typeof ICAL.Component>

export type FeedErrorCode = 'feed_invalid' | 'feed_unreachable' | 'feed_too_large'

/** Een feed die niet te gebruiken is. De boodschap is alleen de code: nooit de URL. */
export class FeedError extends Error {
  constructor(public readonly code: FeedErrorCode) {
    super(code)
  }
}

export interface ParsedFeed {
  /** Eén per UID: het hoofdevent met zijn uitzonderingen, of een losse uitzondering. */
  events: IcalEvent[]
}

export interface ExpandOptions {
  calendarId: string
  /** Eerste dag van het venster, in `timezone`. */
  from: CalendarDate
  /** Laatste dag van het venster (inclusief), in `timezone`. */
  to: CalendarDate
  /** DINGEN_TIMEZONE: voor zwevende tijden en om dagen en tijden te tonen. */
  timezone: string
}

/** Maximaal aantal herhalingen dat we per afspraak doorlopen. */
const MAX_ITERATIONS = 20_000

export function parseFeed(text: string): ParsedFeed {
  let root: IcalComponent
  try {
    const parsed = ICAL.parse(text)
    root = new ICAL.Component(parsed as unknown as unknown[])
  } catch {
    throw new FeedError('feed_invalid')
  }
  if (root.name !== 'vcalendar') throw new FeedError('feed_invalid')

  // Zones met een niet-IANA-naam (zoals Outlook ze schrijft) rekenen via de VTIMEZONE uit de feed.
  for (const vtz of root.getAllSubcomponents('vtimezone')) {
    const tzid = vtz.getFirstPropertyValue('tzid')
    if (typeof tzid === 'string' && !isIanaZone(tzid) && !ICAL.TimezoneService.has(tzid)) {
      ICAL.TimezoneService.register(vtz)
    }
  }

  const byUid = new Map<string, { master: IcalComponent | null; exceptions: IcalComponent[] }>()
  for (const vevent of root.getAllSubcomponents('vevent')) {
    const uid = String(vevent.getFirstPropertyValue('uid') ?? '')
    const entry = byUid.get(uid) ?? { master: null, exceptions: [] }
    if (vevent.hasProperty('recurrence-id')) entry.exceptions.push(vevent)
    else entry.master = vevent
    byUid.set(uid, entry)
  }

  const events: IcalEvent[] = []
  for (const { master, exceptions } of byUid.values()) {
    try {
      if (master) {
        const event = new ICAL.Event(master)
        for (const exception of exceptions) event.relateException(exception)
        events.push(event)
      } else {
        for (const exception of exceptions) events.push(new ICAL.Event(exception))
      }
    } catch {
      // Eén kapotte afspraak mag de rest van de agenda niet tegenhouden.
    }
  }
  return { events }
}

export function expandEvents(feed: ParsedFeed, options: ExpandOptions): CalendarEvent[] {
  const window = {
    from: options.from,
    to: options.to,
    startMs: wallToInstant(dateFields(options.from), options.timezone),
    endMs: wallToInstant(dateFields(nextDay(options.to)), options.timezone),
  }
  const out: CalendarEvent[] = []
  for (const event of feed.events) {
    try {
      expandOne(event, options, window, out)
    } catch {
      // Zie parseFeed: overslaan wat we niet kunnen lezen.
    }
  }
  return out
}

interface Window {
  from: CalendarDate
  to: CalendarDate
  startMs: number
  endMs: number
}

function expandOne(
  event: IcalEvent,
  options: ExpandOptions,
  window: Window,
  out: CalendarEvent[],
): void {
  if (!event.startDate) return
  const tz = zoneOf(event.component, 'dtstart', options.timezone)

  if (!event.isRecurring()) {
    if (isCancelled(event.component)) return
    const end = event.endDate ?? event.startDate
    push(event.component, event.startDate, end, tz, options, window, out)
    return
  }

  const iterator = event.iterator()
  for (let i = 0; i < MAX_ITERATIONS; i++) {
    const next = iterator.next()
    if (!next) break
    const details = event.getOccurrenceDetails(next)
    // Uitzonderingen beoordelen we hieronder op hun eigen (mogelijk verplaatste) tijd.
    if (details.item !== event) continue
    if (startsAfter(details.startDate, tz, window, options.timezone)) break
    push(event.component, details.startDate, details.endDate, tz, options, window, out)
  }

  for (const exception of Object.values(event.exceptions) as IcalEvent[]) {
    if (isCancelled(exception.component)) continue
    const excTz = zoneOf(exception.component, 'dtstart', options.timezone)
    push(
      exception.component,
      exception.startDate,
      exception.endDate ?? exception.startDate,
      excTz,
      options,
      window,
      out,
    )
  }
}

function startsAfter(start: IcalTime, tz: string, window: Window, fallback: string): boolean {
  if (start.isDate) return toDateString(start) > window.to
  return toInstant(start, tz, fallback) >= window.endMs
}

function push(
  component: IcalComponent,
  start: IcalTime,
  end: IcalTime,
  tz: string,
  options: ExpandOptions,
  window: Window,
  out: CalendarEvent[],
): void {
  const uid = String(component.getFirstPropertyValue('uid') ?? '')
  const title = String(component.getFirstPropertyValue('summary') ?? '').trim()
  const locationValue = component.getFirstPropertyValue('location')
  const location = locationValue ? String(locationValue).trim() || null : null

  if (start.isDate) {
    const startDate = toDateString(start)
    const endExclusive = end.isDate ? toDateString(end) : nextDay(startDate)
    const endDate = endExclusive > startDate ? previousDay(endExclusive) : startDate
    if (startDate > window.to || endDate < window.from) return
    out.push({
      id: `${options.calendarId}:${uid}:${startDate}`,
      calendarId: options.calendarId,
      title,
      location,
      allDay: true,
      startDate,
      endDate,
      startTime: null,
      endTime: null,
      start: `${startDate}T00:00:00.000Z`,
      end: `${nextDay(endDate)}T00:00:00.000Z`,
    })
    return
  }

  const startMs = toInstant(start, tz, options.timezone)
  const endTz = end === start ? tz : zoneOfEnd(component, tz, options.timezone)
  const endMs = Math.max(startMs, toInstant(end, endTz, options.timezone))
  // Een afspraak zonder duur telt als moment; hij valt in het venster als hij erin begint.
  if (startMs >= window.endMs || Math.max(endMs, startMs + 1) <= window.startMs) return

  const shown = options.timezone
  const startLocal = instantParts(startMs, shown)
  // Een afspraak die om middernacht eindigt, loopt niet door naar de volgende dag.
  const lastLocal = instantParts(endMs > startMs ? endMs - 1 : endMs, shown)
  const endLocal = instantParts(endMs, shown)
  const startIso = new Date(startMs).toISOString()
  out.push({
    id: `${options.calendarId}:${uid}:${startIso}`,
    calendarId: options.calendarId,
    title,
    location,
    allDay: false,
    startDate: startLocal.date,
    endDate: lastLocal.date,
    startTime: startLocal.time,
    endTime: endLocal.time,
    start: startIso,
    end: new Date(endMs).toISOString(),
  })
}

function isCancelled(component: IcalComponent): boolean {
  return String(component.getFirstPropertyValue('status') ?? '').toUpperCase() === 'CANCELLED'
}

/**
 * De zone waarin een tijd van een component gelezen moet worden: de TZID als
 * die er is, 'UTC' voor tijden met Z, anders de standaardzone.
 */
function zoneOf(component: IcalComponent, property: string, fallback: string): string {
  const prop = component.getFirstProperty(property)
  if (!prop) return fallback
  const tzid = prop.getParameter('tzid')
  if (typeof tzid === 'string' && tzid) return tzid
  const value = prop.getFirstValue() as IcalTime | null
  if (value && typeof value === 'object' && value.zone === ICAL.Timezone.utcTimezone) return 'UTC'
  return fallback
}

function zoneOfEnd(component: IcalComponent, startTz: string, fallback: string): string {
  // Een herhaling of DURATION krijgt zijn eind van ical.js in de zone van het begin.
  if (!component.hasProperty('dtend') || component.hasProperty('rrule')) return startTz
  return zoneOf(component, 'dtend', fallback)
}

/** Tijdstip in ms voor een ICS-tijd in de opgegeven zone. */
function toInstant(time: IcalTime, tz: string, fallback: string): number {
  if (time.zone === ICAL.Timezone.utcTimezone || tz === 'UTC' || tz === 'Z') {
    return Date.UTC(time.year, time.month - 1, time.day, time.hour, time.minute, time.second)
  }
  const fields = {
    year: time.year,
    month: time.month,
    day: time.day,
    hour: time.hour,
    minute: time.minute,
    second: time.second,
  }
  if (isIanaZone(tz)) return wallToInstant(fields, tz)
  const registered = ICAL.TimezoneService.get(tz)
  if (registered) {
    const zoned = time.clone()
    zoned.zone = registered
    return zoned.toUnixTime() * 1000
  }
  // Onbekende zone zonder definitie: lees hem als de standaardzone (de beste gok).
  return wallToInstant(fields, fallback)
}

function toDateString(time: IcalTime): CalendarDate {
  return `${time.year}-${pad(time.month)}-${pad(time.day)}`
}

const zoneCheck = new Map<string, boolean>()

export function isIanaZone(tz: string): boolean {
  let ok = zoneCheck.get(tz)
  if (ok === undefined) {
    try {
      new Intl.DateTimeFormat('en-US', { timeZone: tz })
      ok = true
    } catch {
      ok = false
    }
    zoneCheck.set(tz, ok)
  }
  return ok
}

interface WallFields {
  year: number
  month: number
  day: number
  hour: number
  minute: number
  second: number
}

const formatters = new Map<string, Intl.DateTimeFormat>()

function formatterFor(tz: string): Intl.DateTimeFormat {
  let f = formatters.get(tz)
  if (!f) {
    f = new Intl.DateTimeFormat('en-US', {
      timeZone: tz,
      hourCycle: 'h23',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
    })
    formatters.set(tz, f)
  }
  return f
}

function wallOf(ms: number, tz: string): WallFields {
  const parts: Record<string, number> = {}
  for (const p of formatterFor(tz).formatToParts(new Date(ms))) {
    if (p.type !== 'literal') parts[p.type] = Number(p.value)
  }
  return {
    year: parts.year ?? 1970,
    month: parts.month ?? 1,
    day: parts.day ?? 1,
    hour: parts.hour ?? 0,
    minute: parts.minute ?? 0,
    second: parts.second ?? 0,
  }
}

function asUtc(f: WallFields): number {
  return Date.UTC(f.year, f.month - 1, f.day, f.hour, f.minute, f.second)
}

/**
 * Een kloktijd in een zone naar een tijdstip. Een tijd die niet bestaat (in
 * het gat bij zomertijd) schuift een uur op; een dubbele tijd (bij wintertijd)
 * wordt de eerste.
 */
export function wallToInstant(f: WallFields, tz: string): number {
  const guess = asUtc(f)
  const offset1 = asUtc(wallOf(guess, tz)) - guess
  let result = guess - offset1
  const offset2 = asUtc(wallOf(result, tz)) - result
  if (offset2 !== offset1) {
    const alt = guess - offset2
    // Kies de kandidaat die terugvertaalt naar dezelfde kloktijd; anders de latere (gat).
    result = asUtc(wallOf(alt, tz)) === guess ? alt : Math.max(result, alt)
  }
  // Bij een dubbele tijd: liever de eerdere van de twee, als die ook klopt.
  const earlier = result - 3_600_000
  if (asUtc(wallOf(earlier, tz)) === guess) result = earlier
  return result
}

function instantParts(ms: number, tz: string): { date: CalendarDate; time: string } {
  const f = wallOf(ms, tz)
  return {
    date: `${f.year}-${pad(f.month)}-${pad(f.day)}`,
    time: `${pad(f.hour)}:${pad(f.minute)}`,
  }
}

function dateFields(date: CalendarDate): WallFields {
  const [year, month, day] = date.split('-').map(Number) as [number, number, number]
  return { year, month, day, hour: 0, minute: 0, second: 0 }
}

function shiftDay(date: CalendarDate, days: number): CalendarDate {
  const [y, m, d] = date.split('-').map(Number) as [number, number, number]
  const t = new Date(Date.UTC(y, m - 1, d + days))
  return `${t.getUTCFullYear()}-${pad(t.getUTCMonth() + 1)}-${pad(t.getUTCDate())}`
}

function nextDay(date: CalendarDate): CalendarDate {
  return shiftDay(date, 1)
}

function previousDay(date: CalendarDate): CalendarDate {
  return shiftDay(date, -1)
}

function pad(n: number): string {
  return String(n).padStart(2, '0')
}
