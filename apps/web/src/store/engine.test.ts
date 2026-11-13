import 'fake-indexeddb/auto'
import {
  applyChange,
  type Change,
  createClock,
  type EntityRecord,
  newArea,
  newTask,
  type Placed,
  type PullSpace,
  parseCursorParam,
  recordKey,
  type SpaceCursor,
  type SpaceInfo,
  type Task,
  ulid,
} from '@dingen/core'
import { describe, expect, it } from 'vitest'
import { LocalDb } from './db.js'
import { SyncEngine } from './engine.js'

const PERSONAL = 'SPACEPERSONAL'

/** Nagebootste server met dezelfde semantiek als SyncService (protocol 2), zonder database. */
class FakeServer {
  log: { seq: number; spaceId: string; change: Change }[] = []
  entities = new Map<string, EntityRecord>()
  spaceOf = new Map<string, string>()
  spaces: SpaceInfo[] = [{ id: PERSONAL, kind: 'personal', level: 'manage' }]
  known = new Set<string>()
  offline = false
  requests = 0
  urls: string[] = []
  /** Changes delivered by pulls, to see what a client pulls back. */
  pulled: Change[] = []
  /** Changes per pull answer, over all spaces. */
  pageSize = 500
  /** Delay before each response, to hold a sync run in flight. */
  delayMs = 0
  /** Moves for the next pull, per space (`arrived`, `left`), and the next push answer's `placed`. */
  moves = new Map<string, Pick<PullSpace, 'arrived' | 'left'>>()
  placed: Placed[] | undefined
  /** Pushed changes, as sent. */
  pushed: Change[] = []

  /** Writes a change as the server would store it; a new entity goes to `spaceId`. */
  write(change: Change, spaceId = PERSONAL): void {
    const key = recordKey(change.entityType, change.entityId)
    const space = this.spaceOf.get(key) ?? spaceId
    this.known.add(change.id)
    this.log.push({ seq: this.log.length + 1, spaceId: space, change })
    this.spaceOf.set(key, space)
    this.entities.set(key, applyChange(this.entities.get(key), change))
  }

  /** Back to the first `count` log entries, as a restored backup. */
  restoreTo(count: number): void {
    const log = this.log.slice(0, count)
    this.log = []
    this.entities.clear()
    this.spaceOf.clear()
    this.known.clear()
    for (const entry of log) this.write(entry.change, entry.spaceId)
  }

  private seqOf(spaceId: string): number {
    return this.log.filter((l) => l.spaceId === spaceId).at(-1)?.seq ?? 0
  }

  private live(spaceId: string): EntityRecord[] {
    return [...this.entities]
      .filter(([key, rec]) => this.spaceOf.get(key) === spaceId && rec.data.deleted !== true)
      .map(([, rec]) => rec)
  }

  fetch: typeof fetch = async (input, init) => {
    this.requests += 1
    if (this.delayMs) await new Promise((r) => setTimeout(r, this.delayMs))
    if (this.offline) throw new TypeError('Failed to fetch')
    const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url
    this.urls.push(url)
    const json = (body: unknown, status = 200) =>
      new Response(JSON.stringify(body), {
        status,
        headers: { 'content-type': 'application/json' },
      })
    const params = new URL(url, 'http://x').searchParams
    if (url.startsWith('/api/sync/push')) {
      const { changes, cursor } = JSON.parse(String(init?.body)) as {
        changes: Change[]
        cursor?: SpaceCursor
      }
      const written = new Map<string, { count: number; seq: number }>()
      this.pushed.push(...changes)
      for (const change of changes) {
        if (this.known.has(change.id)) continue
        this.write(change)
        const last = this.log.at(-1)
        if (!last) continue
        const mine = written.get(last.spaceId) ?? { count: 0, seq: 0 }
        written.set(last.spaceId, { count: mine.count + 1, seq: last.seq })
      }
      const advanced: SpaceCursor = {}
      for (const [space, mine] of written) {
        const since = cursor?.[space]
        if (since === undefined) continue
        const after = this.log.filter((l) => l.spaceId === space && l.seq > since).length
        if (after === mine.count) advanced[space] = mine.seq
      }
      const body = {
        seq: this.log.length,
        applied: changes.length,
        duplicates: 0,
        ...(this.placed ? { placed: this.placed } : {}),
      }
      this.placed = undefined
      return json(cursor ? { ...body, cursor: advanced } : body)
    }
    if (url.startsWith('/api/sync/pull')) {
      const raw = params.get('cursor')
      if (raw === null) {
        const since = Number(params.get('since') ?? 0)
        const changes = this.log.filter((l) => l.seq > since).map((l) => l.change)
        return json({ changes, seq: this.log.length, hasMore: false })
      }
      const cursor = parseCursorParam(raw)
      if (cursor === null) return json({ error: 'invalid_cursor' }, 400)
      let budget = this.pageSize
      const out: PullSpace[] = this.spaces.map((space) => {
        const since = typeof cursor === 'number' ? cursor : cursor[space.id]
        // A cursor beyond the log (the server was restored): the space again, marked resync.
        const ahead =
          since !== undefined &&
          since > (typeof cursor === 'number' ? this.log.length : this.seqOf(space.id))
        if (since === undefined || ahead) {
          return {
            ...space,
            seq: this.seqOf(space.id),
            changes: [],
            entities: this.live(space.id),
            hasMore: false,
            ...(ahead ? { resync: true as const } : {}),
          }
        }
        const after = this.log.filter((l) => l.spaceId === space.id && l.seq > since)
        const page = after.slice(0, budget)
        budget -= page.length
        this.pulled.push(...page.map((l) => l.change))
        const moves = this.moves.get(space.id)
        this.moves.delete(space.id)
        return {
          ...space,
          seq: page.at(-1)?.seq ?? since,
          changes: page.map((l) => l.change),
          ...moves,
          hasMore: after.length > page.length,
        }
      })
      return json({
        protocol: 2,
        spaces: out,
        removed:
          typeof cursor === 'number'
            ? []
            : Object.keys(cursor).filter((id) => !this.spaces.some((s) => s.id === id)),
        cursor: Object.fromEntries(out.map((s) => [s.id, s.seq])),
        hasMore: out.some((s) => s.hasMore),
      })
    }
    return json({ error: 'not_found' }, 404)
  }
}

/** Another client, with its own clock. */
const other = createClock('OTHER')

function createdBy(entityType: 'task' | 'area', entity: { id: string }): Change {
  const { id, ...fields } = entity
  return { id: ulid(), entityType, entityId: id, fields, ts: other.now(), clientId: 'OTHER' }
}

function editBy(entityType: 'task' | 'area', id: string, fields: Record<string, unknown>): Change {
  return { id: ulid(), entityType, entityId: id, fields, ts: other.now(), clientId: 'OTHER' }
}

let n = 0
function engineFor(server: FakeServer, dbName = `test-dev${++n}-${Date.now()}-${Math.random()}`) {
  return new SyncEngine({ userId: 'u1', dbName, fetchFn: server.fetch, pushDelayMs: 0 })
}

const settle = () => new Promise((r) => setTimeout(r, 20))
const titles = (engine: SyncEngine) =>
  engine
    .entities('task')
    .map((t) => (t as Task).title)
    .sort()

async function storedMeta(dbName: string) {
  const db = new LocalDb(dbName)
  const meta = await db.meta.toArray()
  db.close()
  return Object.fromEntries(meta.map((m) => [m.key, m.value]))
}

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
    const a = engineFor(server, dbName)
    await a.start()
    a.create('task', newTask({ title: 'Blijft' }))
    await settle()
    await a.sync()
    a.stop()

    const requestsBefore = server.requests
    const again = engineFor(server, dbName)
    await again.start()
    expect(titles(again)).toEqual(['Blijft'])
    // Geen snapshot meer nodig: alleen een pull sinds de cursor.
    expect(server.requests - requestsBefore).toBe(1)
    expect(server.urls.at(-1)).toBe(
      `/api/sync/pull?cursor=${encodeURIComponent(JSON.stringify({ [PERSONAL]: 1 }))}`,
    )
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

describe('SyncEngine with a cursor per space', () => {
  it('starts with an empty cursor and gets every space as a snapshot', async () => {
    const server = new FakeServer()
    server.write(createdBy('task', newTask({ title: 'Eigen taak' })))
    server.spaces.push({ id: 'SHARED', kind: 'shared', level: 'edit' })
    server.write(createdBy('task', newTask({ title: 'Gedeelde taak' })), 'SHARED')

    const dbName = `test-fresh-${Date.now()}`
    const a = engineFor(server, dbName)
    await a.start()
    expect(server.urls[0]).toBe(`/api/sync/pull?cursor=${encodeURIComponent('{}')}`)
    expect(titles(a)).toEqual(['Eigen taak', 'Gedeelde taak'])
    expect(server.pulled).toHaveLength(0)
    a.stop()
    expect((await storedMeta(dbName)).cursors).toEqual({ [PERSONAL]: 1, SHARED: 2 })
  })

  it('takes in a space shared later as a snapshot, and its changes after that', async () => {
    const server = new FakeServer()
    const a = engineFor(server)
    await a.start()
    a.create('task', newTask({ title: 'Eigen taak' }))
    await a.sync()

    // Someone shares a space that already has history.
    const shared = newTask({ title: 'Gedeeld' })
    server.write(createdBy('task', shared), 'SHARED')
    server.write(editBy('task', shared.id, { notes: 'oud' }), 'SHARED')
    server.spaces.push({ id: 'SHARED', kind: 'shared', level: 'edit' })
    await a.sync()
    expect(titles(a)).toEqual(['Eigen taak', 'Gedeeld'])
    expect(a.records.get(recordKey('task', shared.id))?.spaceId).toBe('SHARED')
    // History came as the snapshot, not as changes.
    expect(server.pulled.filter((c) => c.entityId === shared.id)).toHaveLength(0)

    server.write(editBy('task', shared.id, { title: 'Gedeeld, nieuw' }))
    await a.sync()
    expect(titles(a)).toEqual(['Eigen taak', 'Gedeeld, nieuw'])
    a.stop()
  })

  it('drops the data of a space the user left and keeps the rest', async () => {
    const server = new FakeServer()
    server.spaces.push({ id: 'SHARED', kind: 'shared', level: 'read' })
    server.write(createdBy('task', newTask({ title: 'Gedeeld' })), 'SHARED')
    server.write(createdBy('area', newArea({ title: 'Gedeeld gebied' })), 'SHARED')
    const dbName = `test-leave-${Date.now()}`
    const a = engineFor(server, dbName)
    await a.start()
    a.create('task', newTask({ title: 'Eigen taak' }))
    await a.sync()
    expect(titles(a)).toEqual(['Eigen taak', 'Gedeeld'])

    server.spaces = server.spaces.filter((s) => s.id !== 'SHARED')
    await a.sync()
    expect(titles(a)).toEqual(['Eigen taak'])
    expect(a.entities('area')).toEqual([])
    a.stop()

    // Gone from IndexedDB too, and from the cursor.
    const again = engineFor(server, dbName)
    await again.start()
    expect(titles(again)).toEqual(['Eigen taak'])
    again.stop()
    expect(Object.keys((await storedMeta(dbName)).cursors as SpaceCursor)).toEqual([PERSONAL])
  })

  it('loads a space again when the server was restored and its cursor is ahead', async () => {
    const server = new FakeServer()
    const dbName = `test-restore-${Date.now()}`
    const a = engineFor(server, dbName)
    await a.start()
    const first = newTask({ title: 'Een' })
    a.create('task', first)
    await a.sync()
    a.create('task', newTask({ title: 'Twee' }))
    a.create('task', newTask({ title: 'Drie' }))
    await settle()
    await a.sync()
    expect(titles(a)).toEqual(['Drie', 'Een', 'Twee'])

    server.restoreTo(1)
    // A change made while the pull is under way stays in the outbox and stays visible.
    server.delayMs = 30
    const run = a.sync()
    await new Promise((r) => setTimeout(r, 5))
    a.mutate('task', first.id, { title: 'Een, lokaal' })
    await run
    expect(titles(a)).toEqual(['Een, lokaal'])
    server.delayMs = 0
    await settle()
    await a.sync()
    expect(server.entities.get(recordKey('task', first.id))?.data.title).toBe('Een, lokaal')
    expect(titles(a)).toEqual(['Een, lokaal'])
    a.stop()

    // The replaced space is gone from IndexedDB too.
    const again = engineFor(server, dbName)
    await again.start()
    expect(titles(again)).toEqual(['Een, lokaal'])
    again.stop()
  })

  it('moves a stored protocol 1 cursor over to a cursor per space', async () => {
    const server = new FakeServer()
    const known = newTask({ title: 'Al bekend' })
    server.write(createdBy('task', known))
    server.write(createdBy('task', newTask({ title: 'Ook bekend' })))

    // A replica as the web app before protocol 2 left it: records without a space, one cursor.
    const dbName = `test-legacy-${Date.now()}`
    const old = new LocalDb(dbName)
    await old.entities.bulkPut([...server.entities].map(([key, rec]) => ({ key, ...rec })))
    await old.meta.bulkPut([
      { key: 'clientId', value: 'OLDCLIENT' },
      { key: 'cursor', value: 2 },
    ])
    old.close()

    server.write(editBy('task', known.id, { title: 'Hernoemd' }))
    server.write(createdBy('task', newTask({ title: 'Nieuw' })))

    const a = engineFor(server, dbName)
    await a.start()
    expect(server.urls[0]).toBe(`/api/sync/pull?cursor=${encodeURIComponent('2')}`)
    expect(titles(a)).toEqual(['Hernoemd', 'Nieuw', 'Ook bekend'])
    // Only what came after the old cursor was pulled.
    expect(server.pulled).toHaveLength(2)
    a.stop()
    const meta = await storedMeta(dbName)
    expect(meta.cursors).toEqual({ [PERSONAL]: 4 })
    expect(meta.cursor).toBeUndefined()
    expect(meta.clientId).toBe('OLDCLIENT')

    // From now on the cursor per space, and records without a space count as personal.
    server.spaces.push({ id: 'SHARED', kind: 'shared', level: 'edit' })
    const again = engineFor(server, dbName)
    await again.start()
    expect(server.urls.at(-1)).toBe(
      `/api/sync/pull?cursor=${encodeURIComponent(JSON.stringify({ [PERSONAL]: 4 }))}`,
    )
    server.spaces = server.spaces.filter((s) => s.id !== 'SHARED')
    await again.sync()
    expect(titles(again)).toEqual(['Hernoemd', 'Nieuw', 'Ook bekend'])
    again.stop()
  })

  it('does not pull its own pushed changes back, unless someone else wrote in between', async () => {
    const server = new FakeServer()
    const a = engineFor(server)
    await a.start()
    a.create('task', newTask({ title: 'Mijn taak' }))
    await a.sync()
    expect(server.pulled).toHaveLength(0)

    server.write(createdBy('task', newTask({ title: 'Van elders' })))
    a.create('task', newTask({ title: 'Nog een' }))
    await a.sync()
    // The cursor could not skip "Van elders", so both came with the pull.
    expect(server.pulled.map((c) => c.fields.title)).toEqual(['Van elders', 'Nog een'])
    expect(titles(a)).toEqual(['Mijn taak', 'Nog een', 'Van elders'])
    a.stop()
  })

  it('pages through changes over several spaces', async () => {
    const server = new FakeServer()
    server.spaces.push({ id: 'SHARED', kind: 'shared', level: 'edit' })
    const a = engineFor(server)
    await a.start()
    server.pageSize = 1
    server.write(createdBy('task', newTask({ title: 'Een' })))
    server.write(createdBy('task', newTask({ title: 'Twee' })), 'SHARED')
    server.write(createdBy('task', newTask({ title: 'Drie' })))
    await a.sync()
    expect(titles(a)).toEqual(['Drie', 'Een', 'Twee'])
    expect(server.urls.filter((u) => u.startsWith('/api/sync/pull'))).toHaveLength(4)
    a.stop()
  })
})

describe('SyncEngine and moving between spaces', () => {
  /** What the server holds for this task after an edit, as an arrival carries it. */
  function arrival(server: FakeServer, id: string, fields: Record<string, unknown>) {
    server.write(editBy('task', id, fields))
    const rec = server.entities.get(recordKey('task', id)) as EntityRecord
    return { ...rec, data: { ...rec.data }, fieldTs: { ...rec.fieldTs } }
  }

  async function stored(dbName: string, key: string) {
    const db = new LocalDb(dbName)
    const rec = await db.entities.get(key)
    db.close()
    return rec
  }

  it('puts an arrived record in its new space, and drops one that left', async () => {
    const server = new FakeServer()
    server.spaces.push({ id: 'SHARED', kind: 'shared', level: 'edit' })
    const task = newTask({ title: 'Verhuist' })
    server.write(createdBy('task', task))
    const dbName = `test-move-${Date.now()}`
    const a = engineFor(server, dbName)
    await a.start()
    const key = recordKey('task', task.id)
    expect(a.records.get(key)?.spaceId).toBe(PERSONAL)

    // Moved to the shared space (with a new title on the way): the whole record arrives there.
    server.moves.set('SHARED', { arrived: [arrival(server, task.id, { title: 'Verhuisd' })] })
    await a.sync()
    expect(titles(a)).toEqual(['Verhuisd'])
    expect(a.records.get(key)?.spaceId).toBe('SHARED')
    expect((await stored(dbName, key))?.spaceId).toBe('SHARED')

    // A later change in the old space's stream does not move it back.
    server.write(editBy('task', task.id, { notes: 'laat' }))
    await a.sync()
    expect(a.records.get(key)?.spaceId).toBe('SHARED')

    // Then out of sight: gone, also in IndexedDB.
    server.moves.set('SHARED', { left: [{ entityType: 'task', id: task.id }] })
    await a.sync()
    expect(titles(a)).toEqual([])
    a.stop()
    expect(await stored(dbName, key)).toBeUndefined()
  })

  it('asks for a move with spaceId and notes where the push answer says things landed', async () => {
    const server = new FakeServer()
    server.spaces.push({ id: 'SHARED', kind: 'shared', level: 'edit' })
    const a = engineFor(server)
    await a.start()
    const task = newTask({ title: 'Mee' })
    a.create('task', task)
    await a.sync()
    const key = recordKey('task', task.id)
    expect(a.records.get(key)?.spaceId).toBeUndefined()

    a.moveToSpace('task', task.id, 'SHARED')
    expect(a.records.get(key)?.spaceId).toBe('SHARED')
    // spaceId is no entity field: it stays out of the data.
    expect(a.records.get(key)?.data.spaceId).toBeUndefined()
    server.placed = [{ entityType: 'task', id: task.id, spaceId: 'SHARED' }]
    await a.sync()
    expect(server.pushed.at(-1)?.fields).toEqual({ spaceId: 'SHARED' })
    expect(a.records.get(key)?.spaceId).toBe('SHARED')

    // A new entity the server put in another space (its container's) is noted too.
    const next = newTask({ title: 'Nieuw' })
    a.create('task', next)
    server.placed = [{ entityType: 'task', id: next.id, spaceId: 'SHARED' }]
    await a.sync()
    expect(a.records.get(recordKey('task', next.id))?.spaceId).toBe('SHARED')
    a.stop()
  })
})
