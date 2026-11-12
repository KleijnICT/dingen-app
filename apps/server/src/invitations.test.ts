import { eq } from 'drizzle-orm'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { createApp } from './app.js'
import { INVITATION_TTL_MS, invitationStatus } from './auth/invitations.js'
import type { RegistrationMode } from './config.js'
import { type OpenedDatabase, openDatabase } from './db.js'
import { invitations, users } from './schema.js'

const open: OpenedDatabase[] = []

afterEach(() => {
  vi.useRealTimers()
  for (const d of open.splice(0)) d.close()
})

function setup(registration?: RegistrationMode) {
  const database = openDatabase(':memory:')
  open.push(database)
  const app = createApp({
    db: database.db,
    version: 'test',
    sqliteVersion: database.sqliteVersion,
    registration,
  })

  async function call(method: string, path: string, body?: unknown, headers = {}) {
    const res = await app.request(path, {
      method,
      headers: { 'content-type': 'application/json', ...headers },
      body: body === undefined ? undefined : JSON.stringify(body),
    })
    return { res, status: res.status, body: await res.json() }
  }

  async function register(email: string, invite?: string) {
    const r = await call('POST', '/api/auth/register', {
      email,
      password: 'wachtwoord123',
      ...(invite ? { invite } : {}),
    })
    return { ...r, cookie: (r.res.headers.get('set-cookie') ?? '').split(';')[0] ?? '' }
  }

  async function invite(cookie: string) {
    const r = await call('POST', '/api/invitations', undefined, { cookie })
    expect(r.status).toBe(201)
    return r.body as { token: string; invitation: { id: string; status: string } }
  }

  return { database, app, call, register, invite }
}

describe('beheerder', () => {
  it('maakt het eerste account beheerder en de volgende niet', async () => {
    const { register, call } = setup('open')
    const first = await register('eerste@example.com')
    expect(first.body.user.isAdmin).toBe(true)
    const second = await register('tweede@example.com')
    expect(second.body.user.isAdmin).toBe(false)

    const me = await call('GET', '/api/auth/me', undefined, { cookie: first.cookie })
    expect(me.body.user.isAdmin).toBe(true)
    const me2 = await call('GET', '/api/auth/me', undefined, { cookie: second.cookie })
    expect(me2.body.user.isAdmin).toBe(false)
  })

  it('laat alleen de beheerder uitnodigingen zien, maken en intrekken', async () => {
    const { register, call, invite } = setup('open')
    const admin = await register('beheer@example.com')
    const other = await register('ander@example.com')
    const { invitation } = await invite(admin.cookie)

    const headers = { cookie: other.cookie }
    expect((await call('GET', '/api/invitations', undefined, headers)).status).toBe(403)
    expect((await call('POST', '/api/invitations', undefined, headers)).status).toBe(403)
    expect(
      (await call('DELETE', `/api/invitations/${invitation.id}`, undefined, headers)).status,
    ).toBe(403)
    expect((await call('GET', '/api/invitations')).status).toBe(401)
  })

  it('vereist een browsersessie om uitnodigingen te maken', async () => {
    const { register, call } = setup('invite')
    const admin = await register('beheer@example.com')
    const { body } = await call(
      'POST',
      '/api/agents',
      { name: 'proef', icon: 'bot', color: 'gray', grants: [{ scope: 'all', level: 'manage' }] },
      { cookie: admin.cookie },
    )
    const bearer = { authorization: `Bearer ${body.token}` }
    expect((await call('GET', '/api/invitations', undefined, bearer)).status).toBe(200)
    const made = await call('POST', '/api/invitations', undefined, bearer)
    expect(made.status).toBe(403)
    expect(made.body.error).toBe('session_required')
  })
})

describe('registratie per stand', () => {
  it('closed: alleen het eerste account, uitnodigingen werken niet', async () => {
    const { register, invite, call } = setup('closed')
    const admin = await register('beheer@example.com')
    expect(admin.status).toBe(201)
    const { token } = await invite(admin.cookie)
    const second = await register('ander@example.com', token)
    expect(second.status).toBe(401)
    expect(second.body.error).toBe('registration_closed')
    const status = await call('GET', '/api/auth/status')
    expect(status.body).toEqual({ hasUsers: true, registrationOpen: false, registration: 'closed' })
  })

  it('open: iedereen, een uitnodiging is niet nodig en wordt niet verbruikt', async () => {
    const { register, invite, call } = setup('open')
    const admin = await register('beheer@example.com')
    const { token } = await invite(admin.cookie)
    expect((await register('een@example.com')).status).toBe(201)
    expect((await register('twee@example.com', token)).status).toBe(201)
    const list = await call('GET', '/api/invitations', undefined, { cookie: admin.cookie })
    expect(list.body.invitations[0].status).toBe('open')
  })

  it('invite: het eerste account kan zonder uitnodiging', async () => {
    const { register, call } = setup('invite')
    const status = await call('GET', '/api/auth/status')
    expect(status.body).toEqual({ hasUsers: false, registrationOpen: true, registration: 'invite' })
    const first = await register('beheer@example.com')
    expect(first.status).toBe(201)
    expect(first.body.user.isAdmin).toBe(true)
  })

  it('invite: daarna alleen met een geldige uitnodiging, en die maar één keer', async () => {
    const { register, invite, call } = setup('invite')
    const admin = await register('beheer@example.com')

    const without = await register('ander@example.com')
    expect(without.status).toBe(403)
    expect(without.body.error).toBe('invite_required')

    const wrong = await register('ander@example.com', 'verzonnen')
    expect(wrong.body.error).toBe('invite_invalid')

    const { token } = await invite(admin.cookie)
    expect((await call('GET', `/api/auth/invite/${token}`)).body.ok).toBe(true)

    const ok = await register('ander@example.com', token)
    expect(ok.status).toBe(201)
    expect(ok.body.user.isAdmin).toBe(false)

    const again = await register('derde@example.com', token)
    expect(again.status).toBe(403)
    expect(again.body.error).toBe('invite_used')
    const check = await call('GET', `/api/auth/invite/${token}`)
    expect(check.status).toBe(410)
    expect(check.body.error).toBe('invite_used')

    const list = await call('GET', '/api/invitations', undefined, { cookie: admin.cookie })
    expect(list.body.invitations).toEqual([
      expect.objectContaining({
        status: 'used',
        usedBy: 'ander@example.com',
        createdBy: 'beheer@example.com',
      }),
    ])
  })

  it('invite: een bestaand e-mailadres verbruikt de uitnodiging niet', async () => {
    const { register, invite } = setup('invite')
    const admin = await register('beheer@example.com')
    const { token } = await invite(admin.cookie)
    const dup = await register('beheer@example.com', token)
    expect(dup.status).toBe(409)
    expect((await register('nieuw@example.com', token)).status).toBe(201)
  })

  it('invite: een ingetrokken uitnodiging werkt niet meer', async () => {
    const { register, invite, call } = setup('invite')
    const admin = await register('beheer@example.com')
    const { token, invitation } = await invite(admin.cookie)
    const revoked = await call('DELETE', `/api/invitations/${invitation.id}`, undefined, {
      cookie: admin.cookie,
    })
    expect(revoked.status).toBe(200)
    const res = await register('ander@example.com', token)
    expect(res.status).toBe(403)
    expect(res.body.error).toBe('invite_revoked')
    expect((await call('GET', `/api/auth/invite/${token}`)).body.error).toBe('invite_revoked')
  })

  it('invite: een verlopen uitnodiging werkt niet meer', async () => {
    const { register, invite, call } = setup('invite')
    const admin = await register('beheer@example.com')
    const { token } = await invite(admin.cookie)
    vi.useFakeTimers({ toFake: ['Date'] })
    vi.setSystemTime(Date.now() + INVITATION_TTL_MS + 1000)
    const res = await register('ander@example.com', token)
    expect(res.status).toBe(403)
    expect(res.body.error).toBe('invite_expired')
    expect((await call('GET', `/api/auth/invite/${token}`)).body.error).toBe('invite_expired')
  })

  it('een gebruikte uitnodiging kan niet meer worden ingetrokken', async () => {
    const { register, invite, call } = setup('invite')
    const admin = await register('beheer@example.com')
    const { token, invitation } = await invite(admin.cookie)
    await register('ander@example.com', token)
    const res = await call('DELETE', `/api/invitations/${invitation.id}`, undefined, {
      cookie: admin.cookie,
    })
    expect(res.status).toBe(409)
    expect(
      (await call('DELETE', '/api/invitations/bestaat-niet', undefined, { cookie: admin.cookie }))
        .status,
    ).toBe(404)
  })

  it('bewaart alleen de hash van het geheim, 14 dagen geldig', async () => {
    const { register, invite, database } = setup('invite')
    const admin = await register('beheer@example.com')
    const { token, invitation } = await invite(admin.cookie)
    const row = database.db
      .select()
      .from(invitations)
      .where(eq(invitations.id, invitation.id))
      .get()
    expect(row?.tokenHash).not.toContain(token)
    expect(row?.tokenHash).toMatch(/^[0-9a-f]{64}$/)
    const ttl = Date.parse(row?.expiresAt ?? '') - Date.parse(row?.createdAt ?? '')
    expect(ttl).toBe(INVITATION_TTL_MS)
  })
})

describe('invitationStatus', () => {
  const now = new Date('2026-11-11T12:00:00.000Z')
  const base = { usedAt: null, revokedAt: null, expiresAt: '2026-11-20T00:00:00.000Z' }
  it('kiest gebruikt boven ingetrokken boven verlopen', () => {
    expect(invitationStatus(base, now)).toBe('open')
    expect(invitationStatus({ ...base, expiresAt: '2026-11-01T00:00:00.000Z' }, now)).toBe(
      'expired',
    )
    expect(
      invitationStatus({ ...base, revokedAt: 'x', expiresAt: '2026-11-01T00:00:00.000Z' }, now),
    ).toBe('revoked')
    expect(invitationStatus({ ...base, usedAt: 'x', revokedAt: 'x' }, now)).toBe('used')
  })
})

describe('migratie 0005', () => {
  it('maakt het oudste bestaande account beheerder', async () => {
    const { default: Database } = await import('better-sqlite3')
    const { drizzle } = await import('drizzle-orm/better-sqlite3')
    const { migrate } = await import('drizzle-orm/better-sqlite3/migrator')
    const fs = await import('node:fs')
    const os = await import('node:os')
    const path = await import('node:path')
    const { migrationsFolder } = await import('./db.js')

    // Een map met alleen de migraties tot en met 0004.
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'dingen-mig-'))
    try {
      fs.mkdirSync(path.join(dir, 'meta'))
      const journal = JSON.parse(
        fs.readFileSync(path.join(migrationsFolder, 'meta/_journal.json'), 'utf8'),
      ) as { entries: { tag: string }[] }
      const upTo4 = journal.entries.filter((e) => e.tag < '0005')
      for (const e of upTo4) {
        fs.copyFileSync(path.join(migrationsFolder, `${e.tag}.sql`), path.join(dir, `${e.tag}.sql`))
      }
      fs.writeFileSync(
        path.join(dir, 'meta/_journal.json'),
        JSON.stringify({ ...journal, entries: upTo4 }),
      )
      const sqlite = new Database(':memory:')
      const db = drizzle(sqlite)
      migrate(db, { migrationsFolder: dir })
      const insert = sqlite.prepare(
        'insert into users (id, email, password_hash, created_at) values (?, ?, ?, ?)',
      )
      insert.run('B', 'later@example.com', 'x', '2026-02-01T00:00:00.000Z')
      insert.run('A', 'oudste@example.com', 'x', '2026-01-01T00:00:00.000Z')
      insert.run('C', 'laatst@example.com', 'x', '2026-03-01T00:00:00.000Z')

      migrate(db, { migrationsFolder })
      const rows = drizzle(sqlite)
        .select({ email: users.email, isAdmin: users.isAdmin })
        .from(users)
        .all()
      expect(rows.filter((r) => r.isAdmin).map((r) => r.email)).toEqual(['oudste@example.com'])
      sqlite.close()
    } finally {
      fs.rmSync(dir, { recursive: true, force: true })
    }
  })
})
