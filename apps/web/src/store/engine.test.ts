import 'fake-indexeddb/auto'
import {
  applyChange,
  type Change,
  type EntityRecord,
  newTask,
  recordKey,
  type Task,
} from '@dingen/core'
import { describe, expect, it } from 'vitest'
import { SyncEngine } from './engine.js'

/** Nagebootste server met dezelfde semantiek als SyncService, zonder database. */
class FakeServer {
  log: { seq: number; change: Change }[] = []
  entities = new Map<string, EntityRecord>()
  known = new Set<string>()
  offline = false
  requests = 0
  /** Delay before each response, to hold a sync run in flight. */
  delayMs = 0

  fetch: typeof fetch = async (input, init) => {
    this.requests += 1
    if (this.delayMs) await new Promise((r) => setTimeout(r, this.delayMs))
    if (this.offline) throw new TypeError('Failed to fetch')
    const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url
    const json = (body: unknown, status = 200) =>
      new Response(JSON.stringify(body), {
        status,
        headers: { 'content-type': 'application/json' },
      })
    if (url.startsWith('/api/sync/push')) {
      const { changes } = JSON.parse(String(init?.body)) as { changes: Change[] }
      for (const change of changes) {
        if (this.known.has(change.id)) continue
        this.known.add(change.id)
        this.log.push({ seq: this.log.length + 1, change })
        const key = recordKey(change.entityType, change.entityId)
        this.entities.set(key, applyChange(this.entities.get(key), change))
      }
      return json({ seq: this.log.length, applied: changes.length, duplicates: 0 })
    }
    if (url.startsWith('/api/sync/pull')) {
      const since = Number(new URL(url, 'http://x').searchParams.get('since') ?? 0)
      const changes = this.log.filter((l) => l.seq > since).map((l) => l.change)
      return json({ changes, seq: this.log.length, hasMore: false })
    }
    if (url.startsWith('/api/sync/snapshot')) {
      return json({ entities: [...this.entities.values()], seq: this.log.length })
    }
    return json({ error: 'not_found' }, 404)
  }
}

let n = 0
function engineFor(server: FakeServer, name = `dev${++n}`) {
  return new SyncEngine({
    userId: 'u1',
    dbName: `test-${name}-${Date.now()}-${Math.random()}`,
    fetchFn: server.fetch,
    pushDelayMs: 0,
  })
}

const settle = () => new Promise((r) => setTimeout(r, 20))

describe('SyncEngine', () => {
  it('maakt een taak lokaal, pusht hem en een tweede apparaat ziet hem', async () => {
    const server = new FakeServer()
    const a = engineFor(server)
    await a.start()
    a.create('task', newTask({ title: 'Melk kopen' }))
    expect(a.entities('task').map((t) => (t as Task).title)).toEqual(['Melk kopen'])
    await settle()
    await a.sync()
    expect(server.log).toHaveLength(1)

    const b = engineFor(server)
    await b.start()
    expect(b.entities('task').map((t) => (t as Task).title)).toEqual(['Melk kopen'])
    a.stop()
    b.stop()
  })

  it('voegt wijzigingen van twee apparaten per veld samen', async () => {
    const server = new FakeServer()
    const a = engineFor(server)
    const b = engineFor(server)
    await a.start()
    const task = newTask({ title: 'Taak', notes: '' })
    a.create('task', task)
    await settle()
    await a.sync()
    await b.start()

    a.mutate('task', task.id, { status: 'completed', completedAt: new Date().toISOString() })
    b.mutate('task', task.id, { notes: 'Bij de AH' })
    await settle()
    await a.sync()
    await b.sync()
    await a.sync()

    const fromA = a.entities('task')[0] as Task
    const fromB = b.entities('task')[0] as Task
    expect(fromA.status).toBe('completed')
    expect(fromA.notes).toBe('Bij de AH')
    expect(fromB).toEqual(fromA)
    a.stop()
    b.stop()
  })

  it('await sync() during a running sync waits for a run that includes new changes', async () => {
    const server = new FakeServer()
    const a = engineFor(server)
    await a.start()
    const task = newTask({ title: 'Taak' })
    a.create('task', task)
    await a.sync()

    server.delayMs = 30
    const first = a.sync()
    a.mutate('task', task.id, { notes: 'Bij de AH' })
    await a.sync()
    await first
    const onServer = server.entities.get(recordKey('task', task.id))?.data as Task | undefined
    expect(onServer?.notes).toBe('Bij de AH')
    a.stop()
  })

  it('bewaart de outbox als de server onbereikbaar is en pusht later alsnog', async () => {
    const server = new FakeServer()
    const a = engineFor(server)
    await a.start()
    server.offline = true
    a.create('task', newTask({ title: 'Offline gemaakt' }))
    await settle()
    await a.sync()
    expect(a.status).toBe('offline')
    expect(server.log).toHaveLength(0)
    expect(a.entities('task')).toHaveLength(1)

    server.offline = false
    await a.sync()
    expect(a.status).toBe('idle')
    expect(server.log).toHaveLength(1)
    a.stop()
  })

  it('overleeft een herstart: data en cursor komen uit IndexedDB', async () => {
    const server = new FakeServer()
    const dbName = `test-restart-${Date.now()}`
    const a = new SyncEngine({ userId: 'u1', dbName, fetchFn: server.fetch, pushDelayMs: 0 })
    await a.start()
    a.create('task', newTask({ title: 'Blijft' }))
    await settle()
    await a.sync()
    a.stop()

    const requestsBefore = server.requests
    const again = new SyncEngine({ userId: 'u1', dbName, fetchFn: server.fetch, pushDelayMs: 0 })
    await again.start()
    expect(again.entities('task').map((t) => (t as Task).title)).toEqual(['Blijft'])
    // Geen snapshot meer nodig: alleen een pull sinds de cursor.
    expect(server.requests - requestsBefore).toBe(1)
    again.stop()
  })

  it('meldt unauthorized bij 401', async () => {
    const a = new SyncEngine({
      userId: 'u1',
      dbName: `test-401-${Date.now()}`,
      fetchFn: async () => new Response('{"error":"unauthorized"}', { status: 401 }),
      pushDelayMs: 0,
    })
    let called = false
    a.onUnauthorized = () => {
      called = true
    }
    await a.start()
    expect(a.status).toBe('unauthorized')
    expect(called).toBe(true)
    a.stop()
  })
})
