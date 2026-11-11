import {
  type AREA_COLORS,
  type CalendarDate,
  type CalendarEvent,
  type CalendarEventsResponse,
  ulid,
} from '@dingen/core'
import { and, asc, eq } from 'drizzle-orm'
import type { Db } from '../db.js'
import { calendars } from '../schema.js'
import { expandEvents, FeedError, type ParsedFeed, parseFeed } from './ics.js'

/** Haalt de tekst van een feed op; gooit een FeedError. */
export type FetchFeed = (url: string) => Promise<string>

export interface CalendarSummary {
  id: string
  name: string
  color: string | null
  /** Alleen de host van de URL; de URL zelf is geheim. */
  host: string
  createdAt: string
}

export type CalendarColor = (typeof AREA_COLORS)[number]

/** Hoe lang een opgehaalde feed vers is. */
export const REFRESH_MS = 15 * 60_000
/** Wachttijd na een mislukte poging; de oude afspraken blijven zolang staan. */
export const RETRY_MS = 60_000
const FETCH_TIMEOUT_MS = 15_000
const MAX_FEED_BYTES = 10 * 1024 * 1024
/** Langste venster dat een client in één keer mag vragen. */
export const MAX_RANGE_DAYS = 62

interface CacheEntry {
  feed: ParsedFeed | null
  nextFetchAt: number
  pending: Promise<void> | null
}

export class InvalidUrlError extends Error {
  constructor() {
    super('invalid_url')
  }
}

/**
 * Een agenda-URL zoals gebruikers hem plakken: `webcal://` wordt `https://`.
 * Alleen http en https. Gebruikersnaam en wachtwoord in de URL mogen (een
 * Nextcloud-export met app-wachtwoord); ze gaan als Basic-auth mee.
 */
export function normalizeFeedUrl(raw: string): URL {
  let text = raw.trim()
  if (/^webcals?:\/\//i.test(text)) text = text.replace(/^webcals?:/i, 'https:')
  let url: URL
  try {
    url = new URL(text)
  } catch {
    throw new InvalidUrlError()
  }
  if (url.protocol !== 'https:' && url.protocol !== 'http:') throw new InvalidUrlError()
  return url
}

/** Ophalen via HTTP met time-out en maximale grootte. Fouten worden codes, zonder URL. */
export const httpFetchFeed: FetchFeed = async (raw) => {
  const url = new URL(raw)
  const headers: Record<string, string> = {
    accept: 'text/calendar, */*;q=0.5',
    'user-agent': 'Dingen',
  }
  if (url.username || url.password) {
    const user = decodeURIComponent(url.username)
    const pass = decodeURIComponent(url.password)
    headers.authorization = `Basic ${Buffer.from(`${user}:${pass}`).toString('base64')}`
    url.username = ''
    url.password = ''
  }
  let res: Response
  try {
    res = await fetch(url, {
      redirect: 'follow',
      signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
      headers,
    })
  } catch {
    throw new FeedError('feed_unreachable')
  }
  if (!res.ok || !res.body) throw new FeedError('feed_unreachable')
  if (Number(res.headers.get('content-length') ?? 0) > MAX_FEED_BYTES) {
    await res.body.cancel().catch(() => {})
    throw new FeedError('feed_too_large')
  }
  const reader = res.body.getReader()
  const chunks: Uint8Array[] = []
  let size = 0
  try {
    for (;;) {
      const { done, value } = await reader.read()
      if (done) break
      size += value.byteLength
      if (size > MAX_FEED_BYTES) {
        await reader.cancel().catch(() => {})
        throw new FeedError('feed_too_large')
      }
      chunks.push(value)
    }
  } catch (err) {
    if (err instanceof FeedError) throw err
    throw new FeedError('feed_unreachable')
  }
  return new TextDecoder().decode(Buffer.concat(chunks))
}

export interface CalendarServiceOptions {
  fetchFeed?: FetchFeed | undefined
  now?: (() => number) | undefined
}

/** Agenda's per gebruiker plus een cache van de opgehaalde feeds in het geheugen. */
export class CalendarService {
  private readonly cache = new Map<string, CacheEntry>()
  private readonly fetchFeed: FetchFeed
  private readonly now: () => number

  constructor(
    private readonly db: Db,
    options: CalendarServiceOptions = {},
  ) {
    this.fetchFeed = options.fetchFeed ?? httpFetchFeed
    this.now = options.now ?? Date.now
  }

  list(userId: string): CalendarSummary[] {
    return this.rows(userId).map(summary)
  }

  /** Voegt een agenda toe nadat de feed één keer goed is opgehaald en gelezen. */
  async add(
    userId: string,
    input: { name: string; url: string; color: CalendarColor | null },
  ): Promise<CalendarSummary> {
    const url = normalizeFeedUrl(input.url).toString()
    const feed = parseFeed(await this.fetchFeed(url))
    const row = {
      id: ulid(),
      userId,
      name: input.name,
      color: input.color,
      kind: 'ics',
      url,
      createdAt: new Date(this.now()).toISOString(),
    }
    this.db.insert(calendars).values(row).run()
    this.cache.set(row.id, { feed, nextFetchAt: this.now() + REFRESH_MS, pending: null })
    return summary(row)
  }

  update(
    userId: string,
    id: string,
    patch: { name?: string | undefined; color?: CalendarColor | null | undefined },
  ): CalendarSummary | null {
    const set: { name?: string; color?: string | null } = {}
    if (patch.name !== undefined) set.name = patch.name
    if (patch.color !== undefined) set.color = patch.color
    if (Object.keys(set).length > 0) {
      this.db
        .update(calendars)
        .set(set)
        .where(and(eq(calendars.userId, userId), eq(calendars.id, id)))
        .run()
    }
    const row = this.db
      .select()
      .from(calendars)
      .where(and(eq(calendars.userId, userId), eq(calendars.id, id)))
      .get()
    return row ? summary(row) : null
  }

  remove(userId: string, id: string): boolean {
    const result = this.db
      .delete(calendars)
      .where(and(eq(calendars.userId, userId), eq(calendars.id, id)))
      .run()
    this.cache.delete(id)
    return result.changes > 0
  }

  /** Alle afspraken van de gebruiker die het venster raken, gesorteerd op begin. */
  async events(
    userId: string,
    range: { from: CalendarDate; to: CalendarDate; timezone: string },
  ): Promise<CalendarEventsResponse> {
    const rows = this.rows(userId)
    const feeds = await Promise.all(rows.map((row) => this.feedFor(row.id, row.url)))
    const events: CalendarEvent[] = []
    const failed: string[] = []
    rows.forEach((row, i) => {
      const feed = feeds[i]
      if (!feed) {
        failed.push(row.id)
        return
      }
      events.push(...expandEvents(feed, { calendarId: row.id, ...range }))
    })
    events.sort((a, b) => a.start.localeCompare(b.start) || a.id.localeCompare(b.id))
    return {
      timezone: range.timezone,
      calendars: rows.map((row) => ({ id: row.id, name: row.name, color: row.color })),
      events,
      failed,
    }
  }

  private rows(userId: string) {
    return this.db
      .select()
      .from(calendars)
      .where(eq(calendars.userId, userId))
      .orderBy(asc(calendars.createdAt), asc(calendars.id))
      .all()
  }

  /** De feed uit de cache, ververst als hij ouder is dan REFRESH_MS. Null als er nooit iets lukte. */
  private async feedFor(id: string, url: string): Promise<ParsedFeed | null> {
    let entry = this.cache.get(id)
    if (!entry) {
      entry = { feed: null, nextFetchAt: 0, pending: null }
      this.cache.set(id, entry)
    }
    if (!entry.pending && this.now() >= entry.nextFetchAt) {
      const target = entry
      target.pending = this.fetchFeed(url)
        .then((text) => {
          target.feed = parseFeed(text)
          target.nextFetchAt = this.now() + REFRESH_MS
        })
        .catch(() => {
          // Stil: de oude afspraken blijven staan; de URL hoort niet in een log.
          target.nextFetchAt = this.now() + RETRY_MS
        })
        .finally(() => {
          target.pending = null
        })
    }
    if (entry.pending) await entry.pending
    return entry.feed
  }
}

function summary(row: {
  id: string
  name: string
  color: string | null
  url: string
  createdAt: string
}): CalendarSummary {
  let host = ''
  try {
    host = new URL(row.url).host
  } catch {
    // Opgeslagen URL's zijn genormaliseerd; dit is een vangnet.
  }
  return { id: row.id, name: row.name, color: row.color, host, createdAt: row.createdAt }
}
