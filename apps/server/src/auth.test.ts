import { newTask, ulid } from '@dingen/core'
import { afterAll, describe, expect, it } from 'vitest'
import { createApp } from './app.js'
import { openDatabase } from './db.js'

const database = openDatabase(':memory:')
const app = createApp({ db: database.db, version: 'test', sqliteVersion: database.sqliteVersion })

afterAll(() => database.close())

const json = (body: unknown, extra: Record<string, string> = {}) => ({
  method: 'POST',
  headers: { 'content-type': 'application/json', ...extra },
  body: JSON.stringify(body),
})

async function register(email: string, password = 'wachtwoord123') {
  const res = await app.request('/api/auth/register', json({ email, password }))
  return { res, cookie: res.headers.get('set-cookie') ?? '', body: await res.json() }
}

function taskChange(title: string) {
  const { id, ...fields } = newTask({ title })
  return {
    id: ulid(),
    entityType: 'task',
    entityId: id,
    fields,
    ts: `${'0'.repeat(14)}1:00000:T`,
    clientId: 'T',
  }
}

describe('registratie en login', () => {
  it('weigert sync zonder sessie of token', async () => {
    const res = await app.request('/api/sync/snapshot')
    expect(res.status).toBe(401)
  })

  it('laat de eerste gebruiker registreren en sluit daarna de registratie', async () => {
    const before = await (await app.request('/api/auth/status')).json()
    expect(before).toEqual({ hasUsers: false, registrationOpen: true, registration: 'closed' })

    const first = await register('Martien@Example.com')
    expect(first.res.status).toBe(201)
    expect(first.body.user.email).toBe('martien@example.com')
    expect(first.cookie).toMatch(/dingen_session=.+HttpOnly/)
    expect(first.cookie).toMatch(/SameSite=Lax/)

    const after = await (await app.request('/api/auth/status')).json()
    expect(after).toEqual({ hasUsers: true, registrationOpen: false, registration: 'closed' })

    const second = await register('ander@example.com')
    expect(second.res.status).toBe(401)
    expect(second.body.error).toBe('registration_closed')
  })

  it('weigert een zwak wachtwoord en een dubbel e-mailadres', async () => {
    const openApp = createApp({
      db: database.db,
      version: 'test',
      sqliteVersion: database.sqliteVersion,
      registrationOpen: true,
    })
    const weak = await openApp.request(
      '/api/auth/register',
      json({ email: 'x@example.com', password: 'kort' }),
    )
    expect(weak.status).toBe(400)
    const dup = await openApp.request(
      '/api/auth/register',
      json({ email: 'martien@example.com', password: 'wachtwoord123' }),
    )
    expect(dup.status).toBe(409)
  })

  it('logt in met cookie, kent /me, en logt uit', async () => {
    const login = await app.request(
      '/api/auth/login',
      json({ email: 'martien@example.com', password: 'wachtwoord123' }),
    )
    expect(login.status).toBe(200)
    const cookie = login.headers.get('set-cookie') ?? ''
    const me = await app.request('/api/auth/me', { headers: { cookie } })
    expect(me.status).toBe(200)
    expect((await me.json()).user.email).toBe('martien@example.com')

    const logout = await app.request('/api/auth/logout', { method: 'POST', headers: { cookie } })
    expect(logout.status).toBe(200)
    const meAfter = await app.request('/api/auth/me', { headers: { cookie } })
    expect(meAfter.status).toBe(401)
  })

  it('weigert een fout wachtwoord en blokkeert na te veel pogingen', async () => {
    const attempt = () =>
      app.request('/api/auth/login', json({ email: 'martien@example.com', password: 'fout-fout' }))
    for (let i = 0; i < 10; i++) {
      expect((await attempt()).status).toBe(401)
    }
    expect((await attempt()).status).toBe(429)
    // Ook het goede wachtwoord is nu tijdelijk geblokkeerd voor deze combinatie.
    const good = await app.request(
      '/api/auth/login',
      json({ email: 'martien@example.com', password: 'wachtwoord123' }),
    )
    expect(good.status).toBe(429)
  })
})

describe('API-tokens en scheiding', () => {
  it('maakt een token via een sessie, gebruikt hem als Bearer, en kan hem intrekken', async () => {
    // Ander IP dan de geblokkeerde test hierboven: de limiet geldt per e-mail én IP.
    const login = await app.request(
      '/api/auth/login',
      json(
        { email: 'martien@example.com', password: 'wachtwoord123' },
        { 'x-forwarded-for': '10.0.0.2' },
      ),
    )
    expect(login.status).toBe(200)
    const cookie = login.headers.get('set-cookie') ?? ''
    const created = await app.request(
      '/api/agents',
      json(
        { name: 'Claude', icon: 'bot', color: 'gray', grants: [{ scope: 'all', level: 'manage' }] },
        { cookie },
      ),
    )
    expect(created.status).toBe(201)
    const { token, agent } = await created.json()
    expect(token).toMatch(/^dgn_/)
    expect(agent.tokenPrefix).toBe(token.slice(0, 10))

    const me = await app.request('/api/auth/me', { headers: { authorization: `Bearer ${token}` } })
    expect(me.status).toBe(200)
    const meBody = await me.json()
    expect(meBody.source).toBe('token')
    expect(meBody.member).toBe(`agent:${agent.id}`)

    const list = await app.request('/api/agents', { headers: { cookie } })
    expect((await list.json()).agents).toHaveLength(1)

    // Een token mag geen agents maken of zien.
    const viaToken = await app.request(
      '/api/agents',
      json(
        { name: 'nee', icon: 'bot', color: 'gray', grants: [] },
        { authorization: `Bearer ${token}` },
      ),
    )
    expect(viaToken.status).toBe(403)
    const old = await app.request('/api/auth/tokens', { headers: { cookie } })
    expect(old.status).toBe(404)

    const del = await app.request(`/api/agents/${agent.id}`, {
      method: 'DELETE',
      headers: { cookie },
    })
    expect(del.status).toBe(200)
    const meAfter = await app.request('/api/auth/me', {
      headers: { authorization: `Bearer ${token}` },
    })
    expect(meAfter.status).toBe(401)
  })

  it('houdt de data van twee gebruikers gescheiden over de HTTP-laag', async () => {
    const openApp = createApp({
      db: database.db,
      version: 'test',
      sqliteVersion: database.sqliteVersion,
      registrationOpen: true,
    })
    const alice = await openApp.request(
      '/api/auth/register',
      json({ email: 'alice@example.com', password: 'wachtwoord123' }),
    )
    const bob = await openApp.request(
      '/api/auth/register',
      json({ email: 'bob@example.com', password: 'wachtwoord123' }),
    )
    const aliceCookie = alice.headers.get('set-cookie') ?? ''
    const bobCookie = bob.headers.get('set-cookie') ?? ''

    const push = await openApp.request(
      '/api/sync/push',
      json({ changes: [taskChange('Van Alice')] }, { cookie: aliceCookie }),
    )
    expect(push.status).toBe(200)

    const aliceSnap = await (
      await openApp.request('/api/sync/snapshot', { headers: { cookie: aliceCookie } })
    ).json()
    const bobSnap = await (
      await openApp.request('/api/sync/snapshot', { headers: { cookie: bobCookie } })
    ).json()
    expect(aliceSnap.entities).toHaveLength(1)
    expect(bobSnap.entities).toHaveLength(0)
    const bobPull = await (
      await openApp.request('/api/sync/pull', { headers: { cookie: bobCookie } })
    ).json()
    expect(bobPull.changes).toHaveLength(0)
  })
})
