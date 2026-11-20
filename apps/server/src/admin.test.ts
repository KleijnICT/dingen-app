import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { type Change, createClock, newTask, ulid } from '@dingen/core'
import { count, eq } from 'drizzle-orm'
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'
import { seedRegistration, storedRegistration } from './admin/registration.js'
import { AdminError, UserAdmin } from './admin/users.js'
import { createApp } from './app.js'
import { listBackups } from './backup.js'
import { loadConfig } from './config.js'
import { migrationsFolder, openDatabase } from './db.js'
import { SUPERVISOR_ADDRESS } from './ingress.js'
import { PushService } from './push/service.js'
import { CURSOR_GAPS_KEY } from './restore.js'
import { ServerRuntime } from './runtime.js'
import { agents, entities, sessions, spaces } from './schema.js'

const json = (method: string, body: unknown, headers: Record<string, string> = {}) => ({
  method,
  headers: { 'content-type': 'application/json', ...headers },
  body: JSON.stringify(body),
})

const clock = createClock('TEST')
const message = { title: 'Reminder', body: 'Now', tag: 't', url: '/' }
const taskChange = (title: string): Change => {
  const task = newTask({ title, order: 'a0' })
  const { id, ...fields } = task
  return {
    id: ulid(),
    entityType: 'task',
    entityId: id,
    fields,
    ts: clock.now(),
    clientId: 'TEST',
  }
}

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'dingen-admin-'))
const backupDir = path.join(tmp, 'backups')
const database = openDatabase(':memory:')
const restore = vi.fn()
const app = createApp({
  db: database.db,
  version: 'test',
  sqliteVersion: database.sqliteVersion,
  registration: 'open',
  backups: { sqlite: database.sqlite, backupDir, migrationsFolder, restore },
})

afterAll(() => {
  database.close()
  fs.rmSync(tmp, { recursive: true, force: true })
})

async function register(email: string) {
  const res = await app.request(
    '/api/auth/register',
    json('POST', { email, password: 'wachtwoord123' }),
  )
  expect(res.status).toBe(201)
  const body = (await res.json()) as { user: { id: string } }
  return { id: body.user.id, cookie: res.headers.get('set-cookie')?.split(';')[0] ?? '' }
}

async function login(email: string) {
  return app.request('/api/auth/login', json('POST', { email, password: 'wachtwoord123' }))
}

async function makeAgent(cookie: string) {
  const res = await app.request(
    '/api/agents',
    json(
      'POST',
      { name: 'Helper', icon: 'bot', color: 'blue', grants: [{ scope: 'all', level: 'manage' }] },
      { cookie },
    ),
  )
  expect(res.status).toBe(201)
  return ((await res.json()) as { token: string }).token
}

const mcpList = (token: string) =>
  app.request('/mcp', {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      accept: 'application/json, text/event-stream',
      authorization: `Bearer ${token}`,
    },
    body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/list' }),
  })

let admin: { id: string; cookie: string }
let member: { id: string; cookie: string }

beforeAll(async () => {
  admin = await register('admin@example.com')
  member = await register('member@example.com')
})

describe('access to /api/admin', () => {
  it('needs a signed-in administrator in a browser session', async () => {
    expect((await app.request('/api/admin/users')).status).toBe(401)
    const asMember = await app.request('/api/admin/users', { headers: { cookie: member.cookie } })
    expect(asMember.status).toBe(403)
    const token = await makeAgent(admin.cookie)
    const asAgent = await app.request('/api/admin/users', {
      headers: { authorization: `Bearer ${token}` },
    })
    expect(asAgent.status).toBe(403)
    expect(await asAgent.json()).toEqual({ error: 'session_required' })
  })

  it('lists the accounts with admin, blocked and last activity', async () => {
    const res = await app.request('/api/admin/users', { headers: { cookie: admin.cookie } })
    expect(res.status).toBe(200)
    const body = (await res.json()) as {
      users: { email: string; isAdmin: boolean; blockedAt: null; lastActiveAt: string | null }[]
    }
    expect(body.users.map((u) => [u.email, u.isAdmin, u.blockedAt])).toEqual([
      ['admin@example.com', true, null],
      ['member@example.com', false, null],
    ])
    expect(body.users[0]?.lastActiveAt).not.toBeNull()
  })
})

describe('administrators', () => {
  it('makes someone an administrator and back', async () => {
    const up = await app.request(
      `/api/admin/users/${member.id}`,
      json('PATCH', { isAdmin: true }, { cookie: admin.cookie }),
    )
    expect(((await up.json()) as { user: { isAdmin: boolean } }).user.isAdmin).toBe(true)
    // Now the member can see Administration.
    const seen = await app.request('/api/admin/users', { headers: { cookie: member.cookie } })
    expect(seen.status).toBe(200)
    const down = await app.request(
      `/api/admin/users/${member.id}`,
      json('PATCH', { isAdmin: false }, { cookie: admin.cookie }),
    )
    expect(((await down.json()) as { user: { isAdmin: boolean } }).user.isAdmin).toBe(false)
  })

  it('does not let an administrator unadmin, block or delete themselves', async () => {
    for (const body of [{ isAdmin: false }, { blocked: true }]) {
      const res = await app.request(
        `/api/admin/users/${admin.id}`,
        json('PATCH', body, { cookie: admin.cookie }),
      )
      expect(res.status).toBe(409)
      expect(await res.json()).toEqual({ error: 'self' })
    }
    const del = await app.request(
      `/api/admin/users/${admin.id}`,
      json('DELETE', { confirm: 'admin@example.com' }, { cookie: admin.cookie }),
    )
    expect(del.status).toBe(409)
  })

  it('keeps the last administrator', () => {
    const service = new UserAdmin(database.db)
    // Acting as someone else (the HTTP layer never gets here: an actor is an admin).
    expect(() => service.setAdmin(member.id, admin.id, false)).toThrow(AdminError)
    expect(() => service.setBlocked(member.id, admin.id, true)).toThrow(/last_admin/)
  })

  it('answers 404 for an unknown account', async () => {
    const res = await app.request(
      `/api/admin/users/${ulid()}`,
      json('PATCH', { blocked: true }, { cookie: admin.cookie }),
    )
    expect(res.status).toBe(404)
  })
})

describe('blocking', () => {
  it('stops sign-in, sessions, API and agent tokens (also MCP) and pushes, and unblocking restores them', async () => {
    const user = await register('blocked@example.com')
    const token = await makeAgent(user.cookie)
    expect((await mcpList(token)).status).toBe(200)
    const pushed: string[] = []
    const push = new PushService(database.db, 'key', async (target) => {
      pushed.push(target.endpoint)
      return 'sent'
    })
    push.subscribe(
      user.id,
      { endpoint: 'https://push.example/1', keys: { p256dh: 'p', auth: 'a' } },
      null,
    )

    const block = await app.request(
      `/api/admin/users/${user.id}`,
      json('PATCH', { blocked: true }, { cookie: admin.cookie }),
    )
    expect(block.status).toBe(200)
    expect(((await block.json()) as { user: { blockedAt: string } }).user.blockedAt).toBeTruthy()

    const me = await app.request('/api/auth/me', { headers: { cookie: user.cookie } })
    expect(me.status).toBe(401)
    const signIn = await login('blocked@example.com')
    expect(signIn.status).toBe(403)
    expect(await signIn.json()).toEqual({ error: 'account_blocked' })
    const viaToken = await app.request('/api/auth/me', {
      headers: { authorization: `Bearer ${token}` },
    })
    expect(viaToken.status).toBe(401)
    expect((await mcpList(token)).status).toBe(401)
    const sync = await app.request('/api/sync/pull?since=0', {
      headers: { authorization: `Bearer ${token}` },
    })
    expect(sync.status).toBe(401)
    expect(await push.send(user.id, message)).toBe(0)
    expect(pushed).toEqual([])
    const left = database.db
      .select({ n: count() })
      .from(sessions)
      .where(eq(sessions.userId, user.id))
      .get()
    expect(left?.n).toBe(0)

    const unblock = await app.request(
      `/api/admin/users/${user.id}`,
      json('PATCH', { blocked: false }, { cookie: admin.cookie }),
    )
    expect(unblock.status).toBe(200)
    expect((await login('blocked@example.com')).status).toBe(200)
    expect((await mcpList(token)).status).toBe(200)
    expect(await push.send(user.id, message)).toBe(1)
  })
})

describe('blocking a Home Assistant account', () => {
  it('turns it away at the ingress', async () => {
    const env = { ingress: true, incoming: { socket: { remoteAddress: SUPERVISOR_ADDRESS } } }
    const headers = { 'x-remote-user-id': 'ha-blocked', 'x-remote-user-name': 'kim' }
    const first = await app.request('/api/auth/me', { headers }, env)
    expect(first.status).toBe(200)
    const id = ((await first.json()) as { user: { id: string } }).user.id
    await app.request(
      `/api/admin/users/${id}`,
      json('PATCH', { blocked: true }, { cookie: admin.cookie }),
    )
    const again = await app.request('/api/auth/me', { headers }, env)
    expect(again.status).toBe(403)
    expect(await again.json()).toEqual({ error: 'account_blocked' })
  })
})

describe('deleting an account', () => {
  it('only deletes a blocked account, confirmed with its e-mail address', async () => {
    const user = await register('gone@example.com')
    const notBlocked = await app.request(
      `/api/admin/users/${user.id}`,
      json('DELETE', { confirm: 'gone@example.com' }, { cookie: admin.cookie }),
    )
    expect(notBlocked.status).toBe(409)
    expect(await notBlocked.json()).toEqual({ error: 'not_blocked' })
    await app.request(
      `/api/admin/users/${user.id}`,
      json('PATCH', { blocked: true }, { cookie: admin.cookie }),
    )
    const wrong = await app.request(
      `/api/admin/users/${user.id}`,
      json('DELETE', { confirm: 'someone@example.com' }, { cookie: admin.cookie }),
    )
    expect(wrong.status).toBe(400)
    expect(await wrong.json()).toEqual({ error: 'confirm_mismatch' })
  })

  it('makes a back-up, then removes the account and everything of its own', async () => {
    const user = await register('leaver@example.com')
    await makeAgent(user.cookie)
    const agentId = database.db
      .select({ id: agents.id })
      .from(agents)
      .where(eq(agents.userId, user.id))
      .get()?.id as string
    const pushRes = await app.request(
      '/api/sync/push',
      json('POST', { changes: [taskChange('Mine')] }, { cookie: user.cookie }),
    )
    expect(pushRes.status).toBe(200)
    const keep = await app.request(
      '/api/sync/push',
      json('POST', { changes: [taskChange('Admin task')] }, { cookie: admin.cookie }),
    )
    expect(keep.status).toBe(200)
    new PushService(database.db, 'key', async () => 'sent').subscribe(
      user.id,
      { endpoint: 'https://push.example/leaver', keys: { p256dh: 'p', auth: 'a' } },
      null,
    )
    const owned = database.db
      .select({ id: spaces.id })
      .from(spaces)
      .where(eq(spaces.ownerId, user.id))
      .all()
      .map((s) => s.id)
    expect(owned).toHaveLength(1)
    const adminEntities = database.db
      .select({ n: count() })
      .from(entities)
      .where(eq(entities.userId, admin.id))
      .get()?.n

    await app.request(
      `/api/admin/users/${user.id}`,
      json('PATCH', { blocked: true }, { cookie: admin.cookie }),
    )
    const before = listBackups(backupDir).length
    const del = await app.request(
      `/api/admin/users/${user.id}`,
      json('DELETE', { confirm: ' Leaver@Example.com ' }, { cookie: admin.cookie }),
    )
    expect(del.status).toBe(200)
    const body = (await del.json()) as { backup: string; spaces: number; entities: number }
    expect(body.spaces).toBe(1)
    expect(body.entities).toBe(1)
    expect(body.backup).toMatch(/^dingen-pre-delete-/)
    expect(listBackups(backupDir).length).toBe(before + 1)

    const n = (table: string, column: string, value: string) =>
      (
        database.sqlite
          .prepare(`select count(*) as n from ${table} where ${column} = ?`)
          .get(value) as {
          n: number
        }
      ).n
    expect(n('users', 'id', user.id)).toBe(0)
    for (const table of ['sessions', 'api_tokens', 'agents', 'push_subscriptions', 'calendars']) {
      expect(n(table, 'user_id', user.id)).toBe(0)
    }
    expect(n('spaces', 'owner_id', user.id)).toBe(0)
    expect(n('space_members', 'user_id', user.id)).toBe(0)
    expect(n('entities', 'space_id', owned[0] as string)).toBe(0)
    expect(n('changes', 'space_id', owned[0] as string)).toBe(0)
    expect(n('agent_grants', 'agent_id', agentId)).toBe(0)
    // Someone else's data stays.
    expect(n('entities', 'user_id', admin.id)).toBe(adminEntities)
  })
})

describe('registration', () => {
  it('is stored in the database and decides who can register', async () => {
    const get = await app.request('/api/admin/registration', { headers: { cookie: admin.cookie } })
    expect(await get.json()).toEqual({ mode: 'open' })
    const put = await app.request(
      '/api/admin/registration',
      json('PUT', { mode: 'closed' }, { cookie: admin.cookie }),
    )
    expect(put.status).toBe(200)
    const status = (await (await app.request('/api/auth/status')).json()) as {
      registration: string
      registrationOpen: boolean
    }
    expect(status).toMatchObject({ registration: 'closed', registrationOpen: false })
    const closed = await app.request(
      '/api/auth/register',
      json('POST', { email: 'late@example.com', password: 'wachtwoord123' }),
    )
    expect(closed.status).toBe(401)
    const bad = await app.request(
      '/api/admin/registration',
      json('PUT', { mode: 'everyone' }, { cookie: admin.cookie }),
    )
    expect(bad.status).toBe(400)
    await app.request(
      '/api/admin/registration',
      json('PUT', { mode: 'open' }, { cookie: admin.cookie }),
    )
  })

  it('takes the starting value only when nothing is stored', () => {
    const db = openDatabase(':memory:')
    try {
      expect(storedRegistration(db.db)).toBeNull()
      expect(seedRegistration(db.db, 'invite')).toEqual({ mode: 'invite', ignored: false })
      expect(seedRegistration(db.db, 'open')).toEqual({ mode: 'invite', ignored: true })
      // An existing installation keeps its env value after the update.
      createApp({ db: db.db, version: 't', sqliteVersion: db.sqliteVersion, registration: 'open' })
      expect(storedRegistration(db.db)).toBe('invite')
    } finally {
      db.close()
    }
  })
})

describe('back-ups', () => {
  let name = ''

  it('makes one now and lists it with date and size', async () => {
    const made = await app.request('/api/admin/backups', {
      method: 'POST',
      headers: { cookie: admin.cookie },
    })
    expect(made.status).toBe(201)
    name = ((await made.json()) as { backup: { name: string } }).backup.name
    expect(name).toMatch(/^dingen-manual-/)
    const list = (await (
      await app.request('/api/admin/backups', { headers: { cookie: admin.cookie } })
    ).json()) as { backups: { name: string; size: number; at: string }[]; canRestore: boolean }
    expect(list.canRestore).toBe(true)
    const entry = list.backups.find((b) => b.name === name)
    expect(entry?.size).toBeGreaterThan(0)
    expect(Number.isNaN(Date.parse(entry?.at ?? ''))).toBe(false)
  })

  it('downloads the file, for administrators only', async () => {
    const res = await app.request(`/api/admin/backups/${name}`, {
      headers: { cookie: admin.cookie },
    })
    expect(res.status).toBe(200)
    expect(res.headers.get('content-disposition')).toContain(name)
    const bytes = new Uint8Array(await res.arrayBuffer())
    expect(new TextDecoder().decode(bytes.slice(0, 15))).toBe('SQLite format 3')
    expect(bytes.length).toBe(fs.statSync(path.join(backupDir, name)).size)
    const other = await app.request(`/api/admin/backups/${name}`, {
      headers: { cookie: member.cookie },
    })
    expect(other.status).toBe(403)
    for (const bad of ['..%2Fdingen.db', 'notes.txt', 'dingen-manual-2026-01-01T000000Z-0001.db']) {
      const res = await app.request(`/api/admin/backups/${bad}`, {
        headers: { cookie: admin.cookie },
      })
      expect(res.status).toBe(404)
    }
  })

  it('restores after a back-up of the current state', async () => {
    restore.mockClear()
    const res = await app.request(`/api/admin/backups/${name}/restore`, {
      method: 'POST',
      headers: { cookie: admin.cookie },
    })
    expect(res.status).toBe(202)
    const body = (await res.json()) as { saved: string }
    expect(body.saved).toMatch(/^dingen-pre-restore-/)
    await vi.waitFor(() => expect(restore).toHaveBeenCalledTimes(1))
    const [file, keep, fallback] = restore.mock.calls[0] as [string, { userId: string }, string]
    expect(file).toBe(path.join(backupDir, name))
    expect(keep.userId).toBe(admin.id)
    expect(fallback).toBe(path.join(backupDir, body.saved))
  })

  it('refuses a file that is not a Dingen database', async () => {
    const fake = 'dingen-manual-2026-01-01T000000Z-0001.db'
    fs.writeFileSync(path.join(backupDir, fake), 'not a database')
    const res = await app.request(`/api/admin/backups/${fake}/restore`, {
      method: 'POST',
      headers: { cookie: admin.cookie },
    })
    expect(res.status).toBe(422)
    expect(((await res.json()) as { error: string }).error).toBe('invalid_backup')
  })

  it('answers 404 when the server has no back-up directory', async () => {
    const db = openDatabase(':memory:')
    try {
      const bare = createApp({ db: db.db, version: 't', sqliteVersion: db.sqliteVersion })
      const reg = await bare.request(
        '/api/auth/register',
        json('POST', { email: 'a@example.com', password: 'wachtwoord123' }),
      )
      const cookie = reg.headers.get('set-cookie')?.split(';')[0] ?? ''
      expect((await bare.request('/api/admin/backups', { headers: { cookie } })).status).toBe(404)
    } finally {
      db.close()
    }
  })
})

describe('restoring the running server', () => {
  it('swaps the database, keeps the admin signed in and lets clients resync', async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'dingen-runtime-'))
    const config = loadConfig(
      { DATA_DIR: dir, WEB_DIST: path.join(dir, 'no-web') },
      {
        optionsPath: path.join(dir, 'none.json'),
      },
    )
    const log = { log: () => {}, warn: () => {}, error: () => {} }
    const runtime = await ServerRuntime.start(config, { timers: false, log })
    try {
      const call = (p: string, init?: RequestInit) =>
        runtime.fetch(new Request(`http://localhost${p}`, init))
      const reg = await call(
        '/api/auth/register',
        json('POST', { email: 'owner@example.com', password: 'wachtwoord123' }),
      )
      const cookie = reg.headers.get('set-cookie')?.split(';')[0] ?? ''
      const push = (title: string) =>
        call('/api/sync/push', json('POST', { changes: [taskChange(title)] }, { cookie }))
      await push('Before')
      const made = (await (
        await call('/api/admin/backups', { method: 'POST', headers: { cookie } })
      ).json()) as { backup: { name: string } }
      await push('After')

      const res = await call(`/api/admin/backups/${made.backup.name}/restore`, {
        method: 'POST',
        headers: { cookie },
      })
      expect(res.status).toBe(202)
      await vi.waitFor(async () => {
        expect(runtime.busy).toBe(false)
        const titles = runtime.db
          .select({ data: entities.data })
          .from(entities)
          .all()
          .map((e) => (e.data as { title: string }).title)
        expect(titles).toEqual(['Before'])
      })
      // The session was made after the back-up, but the admin is still signed in.
      expect((await call('/api/auth/me', { headers: { cookie } })).status).toBe(200)
      const gaps = runtime.sqlite
        .prepare('select value from meta where key = ?')
        .get(CURSOR_GAPS_KEY) as { value: string } | undefined
      expect(JSON.parse(gaps?.value ?? '[]')).toHaveLength(1)
      const kinds = listBackups(config.backupDir).map((b) => b.kind)
      expect(kinds).toContain('pre-restore')
    } finally {
      runtime.close()
      fs.rmSync(dir, { recursive: true, force: true })
    }
  })
})
