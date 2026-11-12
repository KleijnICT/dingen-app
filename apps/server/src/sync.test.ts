import { type Change, createClock, newProject, newReview, newTask, ulid } from '@dingen/core'
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import { createApp } from './app.js'
import { openDatabase } from './db.js'
import { SyncService, SyncValidationError } from './sync.js'

const database = openDatabase(':memory:')
const app = createApp({ db: database.db, version: 'test', sqliteVersion: database.sqliteVersion })
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

async function get(path: string) {
  const res = await app.request(path, { headers: { authorization: bearer } })
  return { status: res.status, body: await res.json() }
}

describe('sync API', () => {
  it('push, pull en snapshot werken samen', async () => {
    const { change, id } = createTaskChange('Melk kopen')
    const pushed = await push([change])
    expect(pushed.status).toBe(200)
    expect(pushed.body).toMatchObject({ applied: 1, duplicates: 0 })
    expect(pushed.body.seq).toBeGreaterThan(0)

    const pulled = await get('/api/sync/pull?since=0')
    expect(pulled.body.changes).toHaveLength(1)
    expect(pulled.body.changes[0]).toMatchObject({ id: change.id, entityId: id })
    expect(pulled.body.seq).toBe(pushed.body.seq)
    expect(pulled.body.hasMore).toBe(false)

    const again = await get(`/api/sync/pull?since=${pulled.body.seq}`)
    expect(again.body.changes).toHaveLength(0)
    expect(again.body.seq).toBe(pulled.body.seq)

    const snapshot = await get('/api/sync/snapshot')
    expect(snapshot.body.entities).toHaveLength(1)
    expect(snapshot.body.entities[0].data.title).toBe('Melk kopen')
    expect(snapshot.body.seq).toBe(pushed.body.seq)
  })

  it('negeert een wijziging die al bekend is', async () => {
    const { change } = createTaskChange('Dubbel')
    const first = await push([change])
    const second = await push([change])
    expect(second.body).toMatchObject({ applied: 0, duplicates: 1, seq: first.body.seq })
    const pulled = await get('/api/sync/pull')
    expect(pulled.body.changes).toHaveLength(1)
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
    const pulled = await get('/api/sync/pull')
    expect(pulled.body.changes).toHaveLength(2)
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

  it('laat reviews en reviewedAt door, ook naast projecten van vóór reviewedAt', async () => {
    const change = (
      entityType: Change['entityType'],
      entityId: string,
      fields: Record<string, unknown>,
    ): Change => ({ id: ulid(), entityType, entityId, fields, ts: clock.now(), clientId: 'TEST' })

    const { id: reviewId, ...review } = newReview({ kind: 'weekly' })
    // A project as an older client writes it: without reviewedAt.
    const { id: projectId, reviewedAt: _, ...project } = newProject({ title: 'Oud project' })
    const reviewedAt = new Date().toISOString()
    const res = await push([
      change('review', reviewId, review),
      change('project', projectId, project),
      change('project', projectId, { reviewedAt }),
      change('review', reviewId, { doneSteps: ['mindSweep'], completedAt: reviewedAt }),
    ])
    expect(res.status).toBe(200)
    expect(res.body.applied).toBe(4)

    const snapshot = await get('/api/sync/snapshot')
    const byType = (t: string) =>
      snapshot.body.entities.find((e: { entityType: string }) => e.entityType === t)
    expect(byType('review').data).toMatchObject({ kind: 'weekly', doneSteps: ['mindSweep'] })
    expect(byType('project').data.reviewedAt).toBe(reviewedAt)

    const bad = await push([change('review', ulid(), { ...review, kind: 'quarterly' })])
    expect(bad.status).toBe(400)
    expect(bad.body.error).toBe('invalid_changes')
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
})

describe('SyncService', () => {
  it('houdt gebruikers strikt gescheiden', () => {
    service.push('alice', [createTaskChange('Van Alice').change])
    expect(service.snapshot('alice').entities).toHaveLength(1)
    expect(service.snapshot('bob').entities).toHaveLength(0)
    expect(service.pull('bob', 0).changes).toHaveLength(0)
    expect(service.snapshot('bob').seq).toBe(0)
  })

  it('pagineert pull', () => {
    service.push(
      'carol',
      [1, 2, 3].map((n) => createTaskChange(`Taak ${n}`).change),
    )
    const page1 = service.pull('carol', 0, 2)
    expect(page1.changes).toHaveLength(2)
    expect(page1.hasMore).toBe(true)
    const page2 = service.pull('carol', page1.seq, 2)
    expect(page2.changes).toHaveLength(1)
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
