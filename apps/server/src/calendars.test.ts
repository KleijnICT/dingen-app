import type { CalendarEventsResponse } from '@dingen/core'
import { afterAll, beforeEach, describe, expect, it } from 'vitest'
import { createApp } from './app.js'
import { FeedError } from './calendar/ics.js'
import { CalendarService, normalizeFeedUrl, REFRESH_MS, RETRY_MS } from './calendar/service.js'
import { openDatabase } from './db.js'

const SECRET = 'https://agenda.example.org/private-0f9e8d7c6b5a/basic.ics'

function ics(summary: string, start = '20261112T090000'): string {
  return [
    'BEGIN:VCALENDAR',
    'VERSION:2.0',
    'BEGIN:VEVENT',
    `UID:${summary}`,
    `DTSTART;TZID=Europe/Amsterdam:${start}`,
    'DURATION:PT1H',
    `SUMMARY:${summary}`,
    'END:VEVENT',
    'END:VCALENDAR',
  ].join('\r\n')
}

/** Nep-internet: per URL een feed, of een fout. */
const web = new Map<string, string | FeedError>()
const fetched: string[] = []
async function fakeFetch(url: string): Promise<string> {
  fetched.push(url)
  const body = web.get(url)
  if (body === undefined) throw new FeedError('feed_unreachable')
  if (body instanceof FeedError) throw body
  return body
}

const database = openDatabase(':memory:')
const app = createApp({
  db: database.db,
  version: 'test',
  sqliteVersion: database.sqliteVersion,
  registrationOpen: true,
  timezone: 'Europe/Amsterdam',
  fetchFeed: fakeFetch,
})
afterAll(() => database.close())

async function signUp(email: string): Promise<string> {
  const res = await app.request('/api/auth/register', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ email, password: 'wachtwoord123' }),
  })
  return res.headers.get('set-cookie')?.split(';')[0] ?? ''
}

function call(cookie: string, method: string, path: string, body?: unknown) {
  return app.request(path, {
    method,
    headers: { cookie, ...(body ? { 'content-type': 'application/json' } : {}) },
    body: body ? JSON.stringify(body) : undefined,
  })
}

describe('/api/calendars', () => {
  let alice = ''
  let bob = ''

  beforeEach(async () => {
    web.clear()
    fetched.length = 0
    if (!alice) {
      alice = await signUp('alice@example.org')
      bob = await signUp('bob@example.org')
    }
  })

  it('vraagt om in te loggen', async () => {
    expect((await app.request('/api/calendars')).status).toBe(401)
    expect((await app.request('/api/calendars/events?from=2026-11-12&to=2026-11-12')).status).toBe(
      401,
    )
  })

  it('voegt toe, toont zonder URL, hernoemt, kleurt en verwijdert', async () => {
    web.set(SECRET, ics('Tandarts'))
    const added = await call(alice, 'POST', '/api/calendars', {
      name: 'Thuis',
      url: SECRET.replace('https://', 'webcal://'),
      color: 'blue',
    })
    expect(added.status).toBe(201)
    const addedText = await added.text()
    expect(addedText).not.toContain('private-0f9e8d7c6b5a')
    const { calendar } = JSON.parse(addedText) as { calendar: { id: string } }
    expect(calendar).toMatchObject({ name: 'Thuis', color: 'blue', host: 'agenda.example.org' })
    expect(fetched).toEqual([SECRET])

    const listed = await call(alice, 'GET', '/api/calendars')
    const listedText = await listed.text()
    expect(listedText).not.toContain('private-0f9e8d7c6b5a')
    expect(JSON.parse(listedText).calendars).toHaveLength(1)

    // Bob ziet en raakt Alice' agenda niet.
    expect((await (await call(bob, 'GET', '/api/calendars')).json()).calendars).toEqual([])
    expect((await call(bob, 'PATCH', `/api/calendars/${calendar.id}`, { name: 'x' })).status).toBe(
      404,
    )
    expect((await call(bob, 'DELETE', `/api/calendars/${calendar.id}`)).status).toBe(404)

    const patched = await call(alice, 'PATCH', `/api/calendars/${calendar.id}`, {
      name: 'Gezin',
      color: null,
    })
    expect((await patched.json()).calendar).toMatchObject({ name: 'Gezin', color: null })
    expect((await call(alice, 'PATCH', `/api/calendars/${calendar.id}`, {})).status).toBe(400)
    expect(
      (await call(alice, 'PATCH', `/api/calendars/${calendar.id}`, { color: 'chartreuse' })).status,
    ).toBe(400)

    expect((await call(alice, 'DELETE', `/api/calendars/${calendar.id}`)).status).toBe(200)
    expect((await (await call(alice, 'GET', '/api/calendars')).json()).calendars).toEqual([])
  })

  it('weigert een feed die niet te lezen is, zonder de URL te noemen', async () => {
    web.set(SECRET, '<html>Inloggen</html>')
    const invalid = await call(alice, 'POST', '/api/calendars', { name: 'X', url: SECRET })
    expect(await invalid.json()).toEqual({ error: 'feed_invalid' })

    const unreachable = await call(alice, 'POST', '/api/calendars', {
      name: 'X',
      url: 'https://elders.example.org/geheim.ics',
    })
    expect(unreachable.status).toBe(400)
    expect(await unreachable.json()).toEqual({ error: 'feed_unreachable' })

    const notHttp = await call(alice, 'POST', '/api/calendars', {
      name: 'X',
      url: 'file:///etc/passwd',
    })
    expect(await notHttp.json()).toEqual({ error: 'invalid_url' })
    expect(fetched).toEqual([SECRET, 'https://elders.example.org/geheim.ics'])
  })

  it('levert afspraken van alle agenda’s van de gebruiker in een venster', async () => {
    web.set('https://a.example.org/een.ics', ics('Tandarts', '20261112T093000'))
    web.set('https://b.example.org/twee.ics', ics('Training', '20261113T190000'))
    const one = await call(bob, 'POST', '/api/calendars', {
      name: 'Een',
      url: 'https://a.example.org/een.ics',
      color: 'red',
    })
    await call(bob, 'POST', '/api/calendars', {
      name: 'Twee',
      url: 'https://b.example.org/twee.ics',
    })
    const oneId = ((await one.json()) as { calendar: { id: string } }).calendar.id

    const res = await call(bob, 'GET', '/api/calendars/events?from=2026-11-12&to=2026-11-26')
    expect(res.status).toBe(200)
    const body = (await res.json()) as CalendarEventsResponse
    expect(body.timezone).toBe('Europe/Amsterdam')
    expect(body.calendars.map((c) => [c.name, c.color])).toEqual([
      ['Een', 'red'],
      ['Twee', null],
    ])
    expect(body.events.map((e) => [e.title, e.startDate, e.startTime])).toEqual([
      ['Tandarts', '2026-11-12', '09:30'],
      ['Training', '2026-11-13', '19:00'],
    ])
    expect(body.events[0]?.calendarId).toBe(oneId)
    expect(body.failed).toEqual([])

    // Alice ziet niets van Bob.
    const alices = (await (
      await call(alice, 'GET', '/api/calendars/events?from=2026-11-12&to=2026-11-26')
    ).json()) as CalendarEventsResponse
    expect(alices.events).toEqual([])
  })

  it('weigert een ongeldig of te groot venster', async () => {
    for (const q of [
      'from=2026-11-12',
      'from=2026-11-12&to=2026-11-11',
      'from=12-11-2026&to=2026-11-13',
      'from=2026-01-01&to=2026-12-31',
    ]) {
      const res = await call(alice, 'GET', `/api/calendars/events?${q}`)
      expect(res.status, q).toBe(400)
    }
  })
})

describe('CalendarService-cache', () => {
  it('ververst na de vaste termijn, houdt oude afspraken bij een fout en meldt een agenda zonder data', async () => {
    const db = openDatabase(':memory:')
    db.sqlite
      .prepare(
        "insert into users (id, email, password_hash, created_at) values ('u1', 'u@example.org', 'x', '2026-01-01')",
      )
      .run()
    let now = Date.parse('2026-11-12T08:00:00Z')
    const responses = new Map<string, string | FeedError>([
      ['https://x.example.org/a.ics', ics('Eerst')],
    ])
    let calls = 0
    const service = new CalendarService(db.db, {
      now: () => now,
      fetchFeed: async (url) => {
        calls++
        const r = responses.get(url)
        if (!r || r instanceof FeedError) throw r ?? new FeedError('feed_unreachable')
        return r
      },
    })
    const range = { from: '2026-11-12', to: '2026-11-12', timezone: 'Europe/Amsterdam' }
    const cal = await service.add('u1', {
      name: 'A',
      url: 'https://x.example.org/a.ics',
      color: null,
    })
    expect(calls).toBe(1)

    const titles = async () => (await service.events('u1', range)).events.map((e) => e.title)
    expect(await titles()).toEqual(['Eerst'])
    expect(calls).toBe(1)

    responses.set('https://x.example.org/a.ics', ics('Daarna'))
    now += REFRESH_MS - 1
    expect(await titles()).toEqual(['Eerst'])
    now += 1
    expect(await titles()).toEqual(['Daarna'])
    expect(calls).toBe(2)

    // Feed valt weg: oude afspraken blijven, en pas na RETRY_MS een nieuwe poging.
    responses.set('https://x.example.org/a.ics', new FeedError('feed_unreachable'))
    now += REFRESH_MS
    expect(await titles()).toEqual(['Daarna'])
    expect(calls).toBe(3)
    now += RETRY_MS - 1
    await titles()
    expect(calls).toBe(3)
    now += 1
    await titles()
    expect(calls).toBe(4)

    // Een agenda waarvan nooit iets lukte (bijvoorbeeld na een herstart) staat in `failed`.
    const fresh = new CalendarService(db.db, {
      now: () => now,
      fetchFeed: async () => {
        throw new FeedError('feed_unreachable')
      },
    })
    expect(await fresh.events('u1', range)).toMatchObject({ events: [], failed: [cal.id] })
    db.close()
  })

  it('haalt dezelfde feed niet dubbel op bij gelijktijdige vragen', async () => {
    const db = openDatabase(':memory:')
    db.sqlite
      .prepare(
        "insert into users (id, email, password_hash, created_at) values ('u1', 'u@example.org', 'x', '2026-01-01')",
      )
      .run()
    db.sqlite
      .prepare(
        "insert into calendars (id, user_id, name, url, created_at) values ('c1', 'u1', 'A', 'https://x.example.org/a.ics', '2026-01-01')",
      )
      .run()
    let calls = 0
    const service = new CalendarService(db.db, {
      fetchFeed: async () => {
        calls++
        await new Promise((r) => setTimeout(r, 5))
        return ics('Een')
      },
    })
    const range = { from: '2026-11-12', to: '2026-11-12', timezone: 'Europe/Amsterdam' }
    const [a, b] = await Promise.all([service.events('u1', range), service.events('u1', range)])
    expect(calls).toBe(1)
    expect(a.events).toHaveLength(1)
    expect(b.events).toHaveLength(1)
    db.close()
  })
})

describe('normalizeFeedUrl', () => {
  it('maakt van webcal https en weigert andere schema’s', () => {
    expect(normalizeFeedUrl(' webcal://x.example.org/a.ics ').toString()).toBe(
      'https://x.example.org/a.ics',
    )
    expect(normalizeFeedUrl('http://nas.local:8080/a.ics').toString()).toBe(
      'http://nas.local:8080/a.ics',
    )
    expect(() => normalizeFeedUrl('ftp://x.example.org/a.ics')).toThrow()
    expect(() => normalizeFeedUrl('geen url')).toThrow()
  })
})
