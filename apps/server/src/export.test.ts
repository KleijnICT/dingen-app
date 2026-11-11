import { type Change, createClock, newTask, ulid } from '@dingen/core'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { createApp } from './app.js'
import { openDatabase } from './db.js'

const database = openDatabase(':memory:')
const app = createApp({
  db: database.db,
  version: '9.9.9',
  sqliteVersion: database.sqliteVersion,
  registrationOpen: true,
})
const clock = createClock('TEST')

async function account(email: string): Promise<string> {
  const res = await app.request('/api/auth/register', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ email, password: 'wachtwoord123' }),
  })
  const cookie = res.headers.get('set-cookie') ?? ''
  const tokenRes = await app.request('/api/auth/tokens', {
    method: 'POST',
    headers: { 'content-type': 'application/json', cookie },
    body: JSON.stringify({ name: 'test' }),
  })
  return `Bearer ${(await tokenRes.json()).token}`
}

let alice = ''
let bob = ''
beforeAll(async () => {
  alice = await account('alice@test.nl')
  bob = await account('bob@test.nl')
})
afterAll(() => database.close())

function call(bearer: string, path: string, init: RequestInit = {}) {
  return app.request(path, {
    ...init,
    headers: { 'content-type': 'application/json', authorization: bearer },
  })
}

function create(entityType: Change['entityType'], entity: { id: string }, ts = clock.now()) {
  const { id, ...fields } = entity
  return { id: ulid(), entityType, entityId: id, fields, ts, clientId: 'TEST' } satisfies Change
}

async function pushAs(bearer: string, changes: Change[]) {
  const res = await call(bearer, '/api/sync/push', {
    method: 'POST',
    body: JSON.stringify({ changes }),
  })
  expect(res.status).toBe(200)
}

async function snapshotOf(bearer: string) {
  const { entities } = await (await call(bearer, '/api/sync/snapshot')).json()
  return entities.sort((a: { id: string }, b: { id: string }) => (a.id < b.id ? -1 : 1))
}

describe('export en import', () => {
  it('rondgang: export van het ene account, import in een ander geeft hetzelfde', async () => {
    const task = newTask({ title: 'Melk kopen' })
    const other = newTask({ title: 'Verwijderd' })
    await pushAs(alice, [create('task', task), create('task', other)])
    // Een latere wijziging op één veld krijgt een eigen tijdstempel.
    await pushAs(alice, [
      {
        id: ulid(),
        entityType: 'task',
        entityId: task.id,
        fields: { notes: 'Halfvol' },
        ts: clock.now(),
        clientId: 'TEST',
      },
      {
        id: ulid(),
        entityType: 'task',
        entityId: other.id,
        fields: { deleted: true },
        ts: clock.now(),
        clientId: 'TEST',
      },
    ])

    const res = await call(alice, '/api/export')
    expect(res.status).toBe(200)
    expect(res.headers.get('content-disposition')).toMatch(
      /^attachment; filename="dingen-export-\d{4}-\d{2}-\d{2}\.json"$/,
    )
    const file = await res.json()
    expect(file).toMatchObject({ format: 'dingen-export', version: 1, appVersion: '9.9.9' })
    expect(file.entities.task).toHaveLength(1)
    expect(JSON.stringify(file)).not.toMatch(/token|passwordHash|session/i)

    const imported = await call(bob, '/api/import?mode=reject', {
      method: 'POST',
      body: JSON.stringify(file),
    })
    expect(imported.status).toBe(200)
    expect((await imported.json()).total).toEqual({ created: 1, updated: 0, unchanged: 0 })
    expect(await snapshotOf(bob)).toEqual(await snapshotOf(alice))

    // Idempotent: nog een keer importeren verandert niets.
    const again = await call(bob, '/api/import', { method: 'POST', body: JSON.stringify(file) })
    expect((await again.json()).total).toEqual({ created: 0, updated: 0, unchanged: 1 })
    expect(await snapshotOf(bob)).toEqual(await snapshotOf(alice))

    // Clients krijgen het via sync binnen.
    const pulled = await (await call(bob, '/api/sync/pull?since=0')).json()
    expect(pulled.changes.length).toBeGreaterThan(0)
  })

  it('weigert in een niet-leeg account met mode=reject', async () => {
    const file = await (await call(alice, '/api/export')).json()
    const res = await call(alice, '/api/import?mode=reject', {
      method: 'POST',
      body: JSON.stringify(file),
    })
    expect(res.status).toBe(409)
    expect((await res.json()).error).toBe('account_not_empty')
  })

  it('voegt samen op id: de nieuwste wijziging per veld wint', async () => {
    const file = await (await call(alice, '/api/export')).json()
    const [record] = file.entities.task
    // Bob wijzigt de titel later dan de export.
    await pushAs(bob, [
      {
        id: ulid(),
        entityType: 'task',
        entityId: record.id,
        fields: { title: 'Nieuwere titel' },
        ts: clock.now(),
        clientId: 'TEST',
      },
    ])
    // Het bestand bevat een nieuwere notitie dan Bob heeft, en een extra taak.
    const extra = newTask({ title: 'Extra' })
    file.entities.task.push({
      id: extra.id,
      data: extra,
      fieldTs: Object.fromEntries(
        Object.keys(extra)
          .filter((k) => k !== 'id')
          .map((k) => [k, clock.now()]),
      ),
    })
    const res = await call(bob, '/api/import', { method: 'POST', body: JSON.stringify(file) })
    expect(res.status).toBe(200)
    expect((await res.json()).total).toEqual({ created: 1, updated: 0, unchanged: 1 })
    const tasks = (await snapshotOf(bob)).filter(
      (e: { entityType: string }) => e.entityType === 'task',
    )
    expect(tasks).toHaveLength(2)
    expect(tasks.find((t: { id: string }) => t.id === record.id).data.title).toBe('Nieuwere titel')
  })

  it('vraagt authenticatie', async () => {
    expect((await app.request('/api/export')).status).toBe(401)
    expect((await app.request('/api/import', { method: 'POST', body: '{}' })).status).toBe(401)
  })

  it('wijst ongeldige bestanden af zonder iets te schrijven', async () => {
    const carol = await account('carol@test.nl')
    const good = await (await call(alice, '/api/export')).json()

    const cases: [string, unknown][] = [
      ['geen JSON-object', 'tekst'],
      ['verkeerd formaat', { ...good, format: 'iets-anders' }],
      ['onbekende versie', { ...good, version: 2 }],
      [
        'ongeldige taak',
        {
          ...good,
          entities: {
            ...good.entities,
            task: [
              {
                ...good.entities.task[0],
                data: { ...good.entities.task[0].data, status: 'kapot' },
              },
            ],
          },
        },
      ],
      [
        'id wijkt af',
        {
          ...good,
          entities: {
            ...good.entities,
            task: [{ ...good.entities.task[0], id: ulid() }],
          },
        },
      ],
      [
        'tijdstempel ontbreekt',
        {
          ...good,
          entities: {
            ...good.entities,
            task: [{ ...good.entities.task[0], fieldTs: {} }],
          },
        },
      ],
    ]
    for (const [name, body] of cases) {
      const res = await call(carol, '/api/import', { method: 'POST', body: JSON.stringify(body) })
      expect(res.status, name).toBe(400)
      const json = await res.json()
      expect(json.error, name).toBe('invalid_export')
      expect(json.issues.length, name).toBeGreaterThan(0)
    }
    expect(await snapshotOf(carol)).toEqual([])
  })

  it('weigert een onbekende mode', async () => {
    const res = await call(bob, '/api/import?mode=wissen', { method: 'POST', body: '{}' })
    expect(res.status).toBe(400)
  })
})
