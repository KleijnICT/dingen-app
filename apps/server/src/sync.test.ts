import {
  type Change,
  CLIENT_OUTDATED,
  createClock,
  newProject,
  newTask,
  PROTOCOL_HEADER,
  SYNC_PROTOCOL,
  ulid,
} from '@dingen/core'
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import { createApp } from './app.js'
import { openDatabase } from './db.js'
import { createPersonalSpace } from './spaces/service.js'
import { SyncService, SyncValidationError } from './sync.js'

const database = openDatabase(':memory:')
// Open: the service tests below already made accounts, so the HTTP one is not the first.
const app = createApp({
  db: database.db,
  version: 'test',
  sqliteVersion: database.sqliteVersion,
  registrationOpen: true,
})
const service = new SyncService(database.db)
const clock = createClock('TEST')

/** De HTTP-tests draaien als één geregistreerde gebruiker met een API-token. */
let bearer = ''
beforeAll(async () => {
  const res = await app.request('/api/auth/register', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ email: 'sync@test.nl', password: 'wachtwoord123' }),
  })
  const cookie = res.headers.get('set-cookie') ?? ''
  const tokenRes = await app.request('/api/agents', {
    method: 'POST',
    headers: { 'content-type': 'application/json', cookie },
    body: JSON.stringify({
      name: 'test',
      icon: 'bot',
      color: 'gray',
      grants: [{ scope: 'all', level: 'manage' }],
    }),
  })
  bearer = `Bearer ${(await tokenRes.json()).token}`
})

afterAll(() => database.close())

// Accounts for the service tests, each with its personal space (as registration makes them).
for (const id of ['alice', 'bob', 'carol', 'dave']) {
  database.sqlite
    .prepare(
      "insert into users (id, email, password_hash, created_at) values (?, ?, 'x', '2026-01-01')",
    )
    .run(id, `${id}@example.com`)
  createPersonalSpace(database.db, id, '2026-01-01')
}

beforeEach(() => {
  database.sqlite.exec('delete from changes; delete from entities;')
})

function createTaskChange(
  title: string,
  overrides: Partial<Change> = {},
): { change: Change; id: string } {
  const task = newTask({ title })
  const { id, ...fields } = task
  return {
    id,
    change: {
      id: ulid(),
      entityType: 'task',
      entityId: id,
      fields,
      ts: clock.now(),
      clientId: 'TEST',
      ...overrides,
    },
  }
}

async function push(changes: Change[]) {
  const res = await app.request('/api/sync/push', {
    method: 'POST',
    headers: { 'content-type': 'application/json', authorization: bearer },
    body: JSON.stringify({ changes }),
  })
  return { status: res.status, body: await res.json() }
}

async function get(path: string, headers: Record<string, string> = {}) {
  const res = await app.request(path, { headers: { authorization: bearer, ...headers } })
  return { status: res.status, body: await res.json() }
}

/** The personal space of the HTTP user. */
async function personal(): Promise<string> {
  return (await get('/api/sync/snapshot')).body.spaces[0].id
}

/** A pull of the personal space after `since`. */
async function pull(since = 0) {
  const space = await personal()
  const cursor = encodeURIComponent(JSON.stringify({ [space]: since }))
  const res = await get(`/api/sync/pull?cursor=${cursor}`)
  return { ...res, space: res.body.spaces[0] }
}

describe('sync API', () => {
  it('push, pull en snapshot werken samen', async () => {
    const { change, id } = createTaskChange('Melk kopen')
    const pushed = await push([change])
    expect(pushed.status).toBe(200)
    expect(pushed.body).toEqual({ applied: 1, duplicates: 0, placed: expect.any(Array) })

    const pulled = await pull(0)
    expect(pulled.body.protocol).toBe(SYNC_PROTOCOL)
    expect(pulled.space.changes).toHaveLength(1)
    expect(pulled.space.changes[0]).toMatchObject({ id: change.id, entityId: id })
    expect(pulled.space.seq).toBeGreaterThan(0)
    expect(pulled.body.hasMore).toBe(false)

    const again = await pull(pulled.space.seq)
    expect(again.space.changes).toHaveLength(0)
    expect(again.space.seq).toBe(pulled.space.seq)

    const snapshot = await get('/api/sync/snapshot')
    expect(snapshot.body.entities).toHaveLength(1)
    expect(snapshot.body.entities[0].data.title).toBe('Melk kopen')
    expect(snapshot.body.cursor).toEqual({ [pulled.space.id]: pulled.space.seq })
    expect(snapshot.body).not.toHaveProperty('seq')
  })

  it('negeert een wijziging die al bekend is', async () => {
    const { change } = createTaskChange('Dubbel')
    await push([change])
    const second = await push([change])
    expect(second.body).toEqual({ applied: 0, duplicates: 1 })
    const pulled = await pull()
    expect(pulled.space.changes).toHaveLength(1)
  })

  it('past bij een ongeldige batch niets toe', async () => {
    const good = createTaskChange('Goed').change
    const bad: Change = {
      id: ulid(),
      entityType: 'task',
      entityId: ulid(),
      fields: { title: 'Onvolledig' },
      ts: clock.now(),
      clientId: 'TEST',
    }
    const res = await push([good, bad])
    expect(res.status).toBe(400)
    expect(res.body.error).toBe('invalid_changes')
    expect(res.body.problems[0].changeId).toBe(bad.id)
    const snapshot = await get('/api/sync/snapshot')
    expect(snapshot.body.entities).toHaveLength(0)
  })

  it('laat per veld de hoogste tijdstempel winnen, ongeacht aankomstvolgorde', async () => {
    const { change, id } = createTaskChange('Origineel')
    await push([change])
    const older = clock.now()
    const newer = clock.now()
    const edit = (ts: string, title: string): Change => ({
      id: ulid(),
      entityType: 'task',
      entityId: id,
      fields: { title },
      ts,
      clientId: 'ANDER',
    })
    await push([edit(newer, 'Nieuwste')])
    await push([edit(older, 'Verlaat')])
    const snapshot = await get('/api/sync/snapshot')
    expect(snapshot.body.entities[0].data.title).toBe('Nieuwste')
  })

  it('verwijdert via tombstone: weg uit snapshot, wel in pull', async () => {
    const { change, id } = createTaskChange('Weg ermee')
    await push([change])
    await push([
      {
        id: ulid(),
        entityType: 'task',
        entityId: id,
        fields: { deleted: true },
        ts: clock.now(),
        clientId: 'TEST',
      },
    ])
    const snapshot = await get('/api/sync/snapshot')
    expect(snapshot.body.entities).toHaveLength(0)
    const pulled = await pull()
    expect(pulled.space.changes).toHaveLength(2)
  })

  it('accepteert aanmaken en bewerken van dezelfde entiteit in één batch', async () => {
    const { change, id } = createTaskChange('Eerst')
    const edit: Change = {
      id: ulid(),
      entityType: 'task',
      entityId: id,
      fields: { title: 'Daarna' },
      ts: clock.now(),
      clientId: 'TEST',
    }
    const res = await push([change, edit])
    expect(res.body.applied).toBe(2)
    const snapshot = await get('/api/sync/snapshot')
    expect(snapshot.body.entities[0].data.title).toBe('Daarna')
  })

  it('laat reviewedAt door, ook bij projecten van vóór reviewedAt, en weigert reviews', async () => {
    const change = (
      entityType: Change['entityType'],
      entityId: string,
      fields: Record<string, unknown>,
    ): Change => ({ id: ulid(), entityType, entityId, fields, ts: clock.now(), clientId: 'TEST' })

    // A project as an older client writes it: without reviewedAt.
    const { id: projectId, reviewedAt: _, ...project } = newProject({ title: 'Oud project' })
    const reviewedAt = new Date().toISOString()
    const res = await push([
      change('project', projectId, project),
      change('project', projectId, { reviewedAt }),
    ])
    expect(res.status).toBe(200)
    expect(res.body.applied).toBe(2)

    const snapshot = await get('/api/sync/snapshot')
    const byType = (t: string) =>
      snapshot.body.entities.find((e: { entityType: string }) => e.entityType === t)
    expect(byType('project').data.reviewedAt).toBe(reviewedAt)

    // The review frequency of plan 29 syncs as an ordinary field.
    const every = { n: 2, unit: 'month' }
    const set = await push([change('project', projectId, { reviewEvery: every })])
    expect(set.body.applied).toBe(1)
    expect(
      (await get('/api/sync/snapshot')).body.entities.find(
        (e: { entityType: string }) => e.entityType === 'project',
      ).data.reviewEvery,
    ).toEqual(every)

    // The step-by-step review of before plan 29 is no entity type since protocol 4.
    const review = { kind: 'weekly', startedAt: reviewedAt, completedAt: null, doneSteps: [] }
    const bad = await push([
      { ...change('project', ulid(), review), entityType: 'review' } as unknown as Change,
    ])
    expect(bad.status).toBe(400)
    expect(bad.body.error).toBe('invalid_body')
  })

  it('weigert een onleesbare body', async () => {
    const res = await app.request('/api/sync/push', {
      method: 'POST',
      headers: { 'content-type': 'application/json', authorization: bearer },
      body: '{"changes": "nee"}',
    })
    expect(res.status).toBe(400)
    expect((await res.json()).error).toBe('invalid_body')
  })

  it('wants a cursor per space for a pull', async () => {
    for (const query of ['', '?since=0', '?cursor=12', '?cursor=nope']) {
      const res = await get(`/api/sync/pull${query}`)
      expect(res.status, query).toBe(400)
      expect(res.body.error).toBe('invalid_cursor')
    }
  })

  it('refuses clients that speak an older protocol, or name none, with 426 client_outdated', async () => {
    const paths = ['/api/sync/snapshot', `/api/sync/pull?cursor=${encodeURIComponent('{}')}`]
    for (const header of ['3', '1', '', 'nonsense']) {
      for (const path of paths) {
        const res = await get(path, { [PROTOCOL_HEADER]: header })
        expect(res.status, `${path} with ${header}`).toBe(426)
        expect(res.body).toMatchObject({ error: CLIENT_OUTDATED, protocol: 4, minProtocol: 4 })
        expect(res.body.message).toMatch(/out of date/)
      }
    }
    const { change } = createTaskChange('From an old app')
    const res = await app.request('/api/sync/push', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        authorization: bearer,
        [PROTOCOL_HEADER]: '3',
      },
      body: JSON.stringify({ changes: [change] }),
    })
    expect(res.status).toBe(426)
    expect((await get('/api/sync/snapshot')).body.entities).toHaveLength(0)
    // A newer client is served in this server's protocol, which says which one it is.
    const newer = await get('/api/sync/snapshot', { [PROTOCOL_HEADER]: '5' })
    expect(newer.status).toBe(200)
    expect(newer.body.protocol).toBe(SYNC_PROTOCOL)
  })
})

describe('SyncService', () => {
  it('houdt gebruikers strikt gescheiden', () => {
    service.push('alice', [createTaskChange('Van Alice').change])
    expect(service.snapshot('alice').entities).toHaveLength(1)
    expect(service.snapshot('bob').entities).toHaveLength(0)
    expect(service.pullSpaces('bob', {}).spaces[0]?.entities).toHaveLength(0)
    expect(Object.values(service.snapshot('bob').cursor)).toEqual([0])
  })

  it('pagineert pull', () => {
    service.push(
      'carol',
      [1, 2, 3].map((n) => createTaskChange(`Taak ${n}`).change),
    )
    const space = service.snapshot('carol').spaces[0]?.id ?? ''
    const page1 = service.pullSpaces('carol', { [space]: 0 }, 2)
    expect(page1.spaces[0]?.changes).toHaveLength(2)
    expect(page1.hasMore).toBe(true)
    const page2 = service.pullSpaces('carol', page1.cursor, 2)
    expect(page2.spaces[0]?.changes).toHaveLength(1)
    expect(page2.hasMore).toBe(false)
  })

  it('gooit SyncValidationError met de foute wijziging', () => {
    const bad: Change = {
      id: ulid(),
      entityType: 'area',
      entityId: ulid(),
      fields: { title: 'Geen order' },
      ts: clock.now(),
      clientId: 'TEST',
    }
    expect(() => service.push('dave', [bad])).toThrow(SyncValidationError)
  })
})
