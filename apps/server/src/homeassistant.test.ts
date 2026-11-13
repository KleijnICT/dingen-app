import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { eq } from 'drizzle-orm'
import { afterAll, afterEach, beforeEach, describe, expect, it } from 'vitest'
import { createApp } from './app.js'
import { backupBeforeMigrations } from './backup.js'
import { applyLogLevel, loadConfig, parseLogLevel } from './config.js'
import { migrationsFolder, openDatabase } from './db.js'
import { normalizeAddress, parseTrusted, SUPERVISOR_ADDRESS } from './ingress.js'
import { users } from './schema.js'

const SUPERVISOR = { ingress: true, incoming: { socket: { remoteAddress: SUPERVISOR_ADDRESS } } }
const STRANGER = { ingress: true, incoming: { socket: { remoteAddress: '172.30.33.5' } } }

const haHeaders = (id: string, name = 'martien', displayName = 'Martien') => ({
  'x-remote-user-id': id,
  'x-remote-user-name': name,
  'x-remote-user-display-name': displayName,
})

const HA_ID_1 = 'a1b2c3d4e5f60718293a4b5c6d7e8f90'
const HA_ID_2 = '0f9e8d7c6b5a49382716051f2e3d4c5b'

describe('Home Assistant mode: config', () => {
  let dir: string
  beforeEach(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'dingen-ha-config-'))
  })
  afterEach(() => fs.rmSync(dir, { recursive: true, force: true }))

  const optionsPath = () => path.join(dir, 'options.json')

  it('is off without options.json or DINGEN_HA', () => {
    const config = loadConfig({ TZ: 'Europe/London' }, { optionsPath: optionsPath() })
    expect(config.homeAssistant).toBeNull()
    // Outside Home Assistant TZ does not change the default.
    expect(config.timezone).toBe('Europe/Amsterdam')
    expect(config.logLevel).toBe('info')
  })

  it('is on when options.json exists, and reads its options', () => {
    fs.writeFileSync(optionsPath(), JSON.stringify({ registration: 'invite', log_level: 'debug' }))
    const config = loadConfig(
      { TZ: 'Europe/London', DINGEN_REGISTRATION: 'open' },
      { optionsPath: optionsPath() },
    )
    expect(config.homeAssistant).toEqual({ ingressPort: 8099, ingressTrusted: ['172.30.32.2'] })
    expect(config.registration).toBe('invite')
    expect(config.logLevel).toBe('debug')
    expect(config.timezone).toBe('Europe/London')
  })

  it('is on with DINGEN_HA=1; defaults to closed registration', () => {
    const config = loadConfig(
      { DINGEN_HA: '1', DINGEN_INGRESS_TRUSTED: '10.0.0.1, ::ffff:10.0.0.2' },
      { optionsPath: optionsPath() },
    )
    expect(config.homeAssistant?.ingressTrusted).toEqual(['10.0.0.1', '10.0.0.2'])
    expect(config.registration).toBe('closed')
  })

  it('lets DINGEN_TIMEZONE win over TZ', () => {
    fs.writeFileSync(optionsPath(), '{}')
    const config = loadConfig(
      { TZ: 'Europe/London', DINGEN_TIMEZONE: 'Asia/Tokyo' },
      { optionsPath: optionsPath() },
    )
    expect(config.timezone).toBe('Asia/Tokyo')
  })

  it('treats an unreadable options.json as empty options, still HA mode', () => {
    fs.writeFileSync(optionsPath(), 'not json')
    const config = loadConfig({}, { optionsPath: optionsPath() })
    expect(config.homeAssistant).not.toBeNull()
    expect(config.registration).toBe('closed')
  })

  it('parses log levels and mutes the console below the level', () => {
    expect(parseLogLevel('WARN')).toBe('warning')
    expect(parseLogLevel('nonsense')).toBe('info')
    const calls: string[] = []
    const target = {
      debug: () => calls.push('debug'),
      log: () => calls.push('log'),
      info: () => calls.push('info'),
      warn: () => calls.push('warn'),
    }
    applyLogLevel('warning', target)
    target.debug()
    target.log()
    target.info()
    target.warn()
    expect(calls).toEqual(['warn'])
  })

  it('normalizes addresses', () => {
    expect(normalizeAddress('::ffff:172.30.32.2')).toBe('172.30.32.2')
    expect(parseTrusted('')).toEqual([SUPERVISOR_ADDRESS])
  })
})

describe('Home Assistant ingress', () => {
  const database = openDatabase(':memory:')
  const app = createApp({ db: database.db, version: 'test', sqliteVersion: database.sqliteVersion })
  afterAll(() => database.close())

  const viaIngress = (p: string, headers: Record<string, string>, env = SUPERVISOR, init = {}) =>
    app.request(p, { headers, ...init }, env)

  it('refuses connections not from the Supervisor with 403', async () => {
    const res = await viaIngress('/api/auth/me', haHeaders(HA_ID_1), STRANGER)
    expect(res.status).toBe(403)
    const page = await viaIngress('/', haHeaders(HA_ID_1), STRANGER)
    expect(page.status).toBe(403)
    const noAddress = await app.request('/api/auth/me', { headers: haHeaders(HA_ID_1) }, {
      ingress: true,
    } as never)
    expect(noAddress.status).toBe(403)
    expect(database.db.select().from(users).all()).toHaveLength(0)
  })

  it('answers 401 without the HA user headers', async () => {
    const res = await viaIngress('/api/auth/me', {})
    expect(res.status).toBe(401)
    const health = await viaIngress('/api/health', {})
    expect(health.status).toBe(401)
  })

  it('creates an admin account for the first HA user, once, and signs it in as owner', async () => {
    const res = await viaIngress('/api/auth/me', {
      ...haHeaders(HA_ID_1),
      'x-ingress-path': '/api/hassio_ingress/abc123',
    })
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.user).toMatchObject({
      email: 'martien@home-assistant.invalid',
      isAdmin: true,
      homeAssistant: true,
      hasPassword: false,
    })
    expect(body.source).toBe('session')
    expect(body.member).toBe(`user:${body.user.id}`)
    expect(body.ingress).toBe(true)
    // No cookie needed on ingress.
    expect(res.headers.get('set-cookie')).toBeNull()

    const again = await (await viaIngress('/api/auth/me', haHeaders(HA_ID_1))).json()
    expect(again.user.id).toBe(body.user.id)
    expect(database.db.select().from(users).all()).toHaveLength(1)

    // The owner can use account-wide endpoints.
    const snapshot = await viaIngress('/api/sync/snapshot', haHeaders(HA_ID_1))
    expect(snapshot.status).toBe(200)
  })

  it('gives a second HA user a separate, non-admin account, even with registration closed', async () => {
    const res = await viaIngress('/api/auth/me', haHeaders(HA_ID_2, 'anne', 'Anne'))
    const body = await res.json()
    expect(body.user).toMatchObject({
      email: 'anne@home-assistant.invalid',
      isAdmin: false,
      homeAssistant: true,
    })
    const first = await (await viaIngress('/api/auth/me', haHeaders(HA_ID_1))).json()
    expect(body.user.id).not.toBe(first.user.id)
  })

  it('picks another email when the username is taken', async () => {
    const res = await viaIngress(
      '/api/auth/me',
      haHeaders('ffffffff000000000000000000000000', 'Martien', 'Ander'),
    )
    const body = await res.json()
    expect(body.user.email).toBe('martien-ffffffff@home-assistant.invalid')
  })

  it('ignores HA headers on the normal port', async () => {
    const res = await app.request('/api/auth/me', { headers: haHeaders(HA_ID_1) })
    expect(res.status).toBe(401)
    // Also with an env that is not the ingress listener.
    const res2 = await app.request(
      '/api/auth/me',
      { headers: haHeaders(HA_ID_1) },
      { incoming: { socket: { remoteAddress: SUPERVISOR_ADDRESS } } },
    )
    expect(res2.status).toBe(401)
  })

  it('lets an HA account set a password without a current one, then sign in on the normal port', async () => {
    const json = { 'content-type': 'application/json' }
    const set = await viaIngress(
      '/api/auth/password',
      { ...haHeaders(HA_ID_1), ...json },
      SUPERVISOR,
      {
        method: 'POST',
        body: JSON.stringify({ password: 'nieuwwachtwoord' }),
      },
    )
    expect(set.status).toBe(200)

    const me = await (await viaIngress('/api/auth/me', haHeaders(HA_ID_1))).json()
    expect(me.user.hasPassword).toBe(true)

    // Now a current password is required.
    const again = await viaIngress(
      '/api/auth/password',
      { ...haHeaders(HA_ID_1), ...json },
      SUPERVISOR,
      {
        method: 'POST',
        body: JSON.stringify({ password: 'nogeenwachtwoord' }),
      },
    )
    expect(again.status).toBe(400)
    expect((await again.json()).error).toBe('password_required')

    const login = await app.request('/api/auth/login', {
      method: 'POST',
      headers: json,
      body: JSON.stringify({
        email: 'martien@home-assistant.invalid',
        password: 'nieuwwachtwoord',
      }),
    })
    expect(login.status).toBe(200)
    const cookie = login.headers.get('set-cookie') ?? ''
    const meOnPort = await (await app.request('/api/auth/me', { headers: { cookie } })).json()
    expect(meOnPort.user).toMatchObject({ homeAssistant: true, hasPassword: true })
    expect(meOnPort.ingress).toBe(false)
  })

  it('never lets an HA account without a password sign in on the normal port', async () => {
    for (const password of ['!none', '', 'wachtwoord123']) {
      const login = await app.request('/api/auth/login', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ email: 'anne@home-assistant.invalid', password }),
      })
      expect(login.status).not.toBe(200)
    }
  })
})

describe('changing the password (normal account)', () => {
  const database = openDatabase(':memory:')
  const app = createApp({ db: database.db, version: 'test', sqliteVersion: database.sqliteVersion })
  afterAll(() => database.close())
  const json = { 'content-type': 'application/json' }

  it('requires the current password', async () => {
    const reg = await app.request('/api/auth/register', {
      method: 'POST',
      headers: json,
      body: JSON.stringify({ email: 'x@example.com', password: 'wachtwoord123' }),
    })
    const cookie = reg.headers.get('set-cookie') ?? ''
    const me = await (await app.request('/api/auth/me', { headers: { cookie } })).json()
    expect(me.user).toMatchObject({ homeAssistant: false, hasPassword: true })
    const change = (body: unknown) =>
      app.request('/api/auth/password', {
        method: 'POST',
        headers: { ...json, cookie },
        body: JSON.stringify(body),
      })
    expect((await change({ password: 'nieuwwachtwoord' })).status).toBe(400)
    expect(
      (await change({ currentPassword: 'fout-fout', password: 'nieuwwachtwoord' })).status,
    ).toBe(401)
    expect(
      (await change({ currentPassword: 'wachtwoord123', password: 'nieuwwachtwoord' })).status,
    ).toBe(200)
    const unauth = await app.request('/api/auth/password', {
      method: 'POST',
      headers: json,
      body: JSON.stringify({ password: 'nieuwwachtwoord' }),
    })
    expect(unauth.status).toBe(401)
  })
})

describe('migration 0007 (ha_user_id)', () => {
  let dir: string
  beforeEach(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'dingen-ha-migration-'))
  })
  afterEach(() => fs.rmSync(dir, { recursive: true, force: true }))

  it('applies on an existing database and keeps its accounts', async () => {
    // Migrations up to 0006, as an existing install has them.
    const old = path.join(dir, 'drizzle-0006')
    fs.cpSync(migrationsFolder, old, { recursive: true })
    const journalFile = path.join(old, 'meta/_journal.json')
    const journal = JSON.parse(fs.readFileSync(journalFile, 'utf8')) as {
      entries: { tag: string }[]
    }
    journal.entries = journal.entries.filter((e) => e.tag < '0007')
    fs.writeFileSync(journalFile, JSON.stringify(journal))

    const databasePath = path.join(dir, 'data', 'dingen.db')
    const before = openDatabase(databasePath, { migrationsFolder: old })
    before.sqlite
      .prepare('insert into users (id, email, password_hash, created_at) values (?, ?, ?, ?)')
      .run('U1', 'oud@example.com', 'x', '2026-11-01T00:00:00.000Z')
    const columns = before.sqlite.prepare('pragma table_info(users)').all() as { name: string }[]
    expect(columns.map((c) => c.name)).not.toContain('ha_user_id')
    before.close()

    const backup = await backupBeforeMigrations({
      databasePath,
      backupDir: path.join(dir, 'data', 'backups'),
      migrationsFolder,
    })
    expect(backup?.pending).toContain('0007_ha_users')

    const after = openDatabase(databasePath)
    const row = after.db.select().from(users).where(eq(users.id, 'U1')).get()
    expect(row).toMatchObject({ email: 'oud@example.com', haUserId: null })
    // Unique: one Dingen account per HA user.
    after.db.update(users).set({ haUserId: 'h1' }).where(eq(users.id, 'U1')).run()
    expect(() =>
      after.sqlite
        .prepare(
          'insert into users (id, email, password_hash, created_at, ha_user_id) values (?, ?, ?, ?, ?)',
        )
        .run('U2', 'twee@example.com', 'x', '2026-11-01T00:00:00.000Z', 'h1'),
    ).toThrow(/UNIQUE/)
    after.close()
  })
})
