import {
  type Change,
  createClock,
  newArea,
  newTask,
  type PullResponse,
  type SnapshotResponse,
  SYNC_PROTOCOL,
  ulid,
} from '@dingen/core'
import { and, eq } from 'drizzle-orm'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { createApp } from '../app.js'
import { type OpenedDatabase, openDatabase } from '../db.js'
import { changes, entities, spaceMembers, spaces } from '../schema.js'
import { SyncService } from '../sync.js'
import { createPersonalSpace } from './service.js'

/** Sync protocol 2: a cursor per space (plan 23, part 2). */

const clock = createClock('SPACESYNC')
const opened: OpenedDatabase[] = []

afterEach(() => {
  for (const d of opened.splice(0)) d.close()
})

function created(entityType: 'task' | 'area', entity: { id: string }): Change {
  const { id, ...fields } = entity
  return { id: ulid(), entityType, entityId: id, fields, ts: clock.now(), clientId: 'T' }
}

function edit(entityType: 'task' | 'area', id: string, fields: Record<string, unknown>): Change {
  return { id: ulid(), entityType, entityId: id, fields, ts: clock.now(), clientId: 'T' }
}

const titles = (list: { data?: Record<string, unknown>; fields?: Record<string, unknown> }[]) =>
  list.map((x) => (x.data ?? x.fields)?.title)

describe('sync per space (service)', () => {
  let database: OpenedDatabase
  let sync: SyncService
  let pa: string
  let pb: string
  let shared: string

  function addUser(id: string): string {
    database.sqlite
      .prepare("insert into users (id, email, password_hash, created_at) values (?, ?, 'x', ?)")
      .run(id, `${id.toLowerCase()}@example.com`, '2026-01-01T00:00:00.000Z')
    return createPersonalSpace(database.db, id, '2026-01-01T00:00:00.000Z')
  }

  /** A shared space of A, made by hand (inviting comes later), with B at `level` or not at all. */
  function makeShared(level: 'read' | 'edit' | null): string {
    const id = `S${ulid()}`
    const at = '2026-02-01T00:00:00.000Z'
    database.db.insert(spaces).values({ id, kind: 'shared', ownerId: 'A', createdAt: at }).run()
    database.db
      .insert(spaceMembers)
      .values({ spaceId: id, userId: 'A', level: 'manage', joinedAt: at })
      .run()
    if (level) join('B', id, level)
    return id
  }

  function join(userId: string, spaceId: string, level: 'read' | 'edit') {
    database.db
      .insert(spaceMembers)
      .values({ spaceId, userId, level, joinedAt: '2026-02-02T00:00:00.000Z' })
      .run()
  }

  /** Creates an entity of A straight in the shared space, as moving will (part 3). */
  function inShared(entityType: 'task' | 'area', entity: { id: string }) {
    const { seq } = sync.push('A', [created(entityType, entity)])
    database.db.update(entities).set({ spaceId: shared }).where(eq(entities.id, entity.id)).run()
    database.db
      .update(changes)
      .set({ spaceId: shared })
      .where(eq(changes.entityId, entity.id))
      .run()
    return seq
  }

  beforeEach(() => {
    database = openDatabase(':memory:')
    opened.push(database)
    sync = new SyncService(database.db)
    pa = addUser('A')
    pb = addUser('B')
    shared = makeShared('edit')
  })

  it('an empty cursor gets every space as a snapshot, personal first', () => {
    sync.push('A', [created('task', newTask({ title: 'A private', order: 'a' }))])
    const seq = inShared('task', newTask({ title: 'Together', order: 'b' }))
    sync.push('B', [created('task', newTask({ title: 'B private', order: 'a' }))])

    const forB = sync.pullSpaces('B', {})
    expect(forB.protocol).toBe(SYNC_PROTOCOL)
    expect(forB.spaces.map((s) => [s.id, s.kind, s.level])).toEqual([
      [pb, 'personal', 'manage'],
      [shared, 'shared', 'edit'],
    ])
    expect(forB.spaces.map((s) => titles(s.entities ?? []))).toEqual([['B private'], ['Together']])
    expect(forB.spaces.every((s) => s.changes.length === 0)).toBe(true)
    expect(forB.cursor).toEqual({ [pb]: 3, [shared]: seq })
    expect(forB.removed).toEqual([])
    expect(forB.hasMore).toBe(false)
  })

  it('delivers changes per space after the cursor of each space', () => {
    const task = newTask({ title: 'Together', order: 'b' })
    inShared('task', task)
    const start = sync.pullSpaces('B', {}).cursor

    sync.push('B', [created('task', newTask({ title: 'B new', order: 'a' }))])
    sync.push('A', [edit('task', task.id, { title: 'Together, renamed' })])
    sync.push('A', [created('task', newTask({ title: 'A private', order: 'a' }))])
    sync.push('B', [edit('task', task.id, { notes: 'by B' })])

    const body = sync.pullSpaces('B', start)
    const bySpace = Object.fromEntries(body.spaces.map((s) => [s.id, s]))
    expect(titles(bySpace[pb]?.changes ?? [])).toEqual(['B new'])
    expect(bySpace[shared]?.changes.map((c) => c.fields)).toEqual([
      { title: 'Together, renamed' },
      { notes: 'by B' },
    ])
    // A's private task is in none of B's spaces.
    expect(body.spaces.flatMap((s) => s.changes).map((c) => c.fields.title)).not.toContain(
      'A private',
    )
    expect(body.cursor).toEqual({ [pb]: 2, [shared]: 5 })
    expect(body.spaces.some((s) => s.entities)).toBe(false)

    // Nothing new: the same cursor back, no changes.
    const again = sync.pullSpaces('B', body.cursor)
    expect(again.cursor).toEqual(body.cursor)
    expect(again.spaces.flatMap((s) => s.changes)).toEqual([])
  })

  it('a space joined later comes as a snapshot of that space only', () => {
    const later = makeShared(null)
    const area = newArea({ title: 'Joined', order: 'a' })
    const { seq } = sync.push('A', [created('area', area)])
    database.db.update(entities).set({ spaceId: later }).where(eq(entities.id, area.id)).run()
    database.db.update(changes).set({ spaceId: later }).where(eq(changes.entityId, area.id)).run()
    sync.push('A', [edit('area', area.id, { title: 'Joined, renamed' })])

    const before = sync.pullSpaces('B', {}).cursor
    expect(Object.keys(before)).not.toContain(later)

    join('B', later, 'read')
    const body = sync.pullSpaces('B', before)
    const space = body.spaces.find((s) => s.id === later)
    expect(space?.level).toBe('read')
    expect(titles(space?.entities ?? [])).toEqual(['Joined, renamed'])
    expect(space?.changes).toEqual([])
    expect(body.cursor[later]).toBe(seq + 1)
    // The known spaces carry on from their cursor, without a snapshot.
    expect(body.spaces.filter((s) => s.entities).map((s) => s.id)).toEqual([later])
  })

  it('a space the user left is reported as removed', () => {
    inShared('task', newTask({ title: 'Together', order: 'b' }))
    const cursor = sync.pullSpaces('B', {}).cursor
    database.db
      .delete(spaceMembers)
      .where(and(eq(spaceMembers.spaceId, shared), eq(spaceMembers.userId, 'B')))
      .run()
    const body = sync.pullSpaces('B', cursor)
    expect(body.removed).toEqual([shared])
    expect(body.cursor).toEqual({ [pb]: 0 })
    expect(body.spaces.map((s) => s.id)).toEqual([pb])
  })

  it('pages over spaces with one limit, in order within each space', () => {
    const cursor = sync.pullSpaces('A', {}).cursor
    sync.push('A', [created('task', newTask({ title: 'One', order: 'a' }))])
    inShared('task', newTask({ title: 'Two', order: 'b' }))
    sync.push('A', [created('task', newTask({ title: 'Three', order: 'c' }))])
    inShared('task', newTask({ title: 'Four', order: 'd' }))

    const seen: string[] = []
    let next = cursor
    let pages = 0
    for (let more = true; more; pages++) {
      const body = sync.pullSpaces('A', next, 1)
      expect(body.spaces.flatMap((s) => s.changes).length).toBeLessThanOrEqual(1)
      for (const s of body.spaces) seen.push(...titles(s.changes).map((t) => `${s.kind}:${t}`))
      next = body.cursor
      more = body.hasMore
    }
    expect(pages).toBe(4)
    expect(seen).toEqual(['personal:One', 'personal:Three', 'shared:Two', 'shared:Four'])
    expect(next).toEqual({ [pa]: 3, [shared]: 4 })
  })

  it('a number as cursor (protocol 1) counts for every space, without snapshots', () => {
    sync.push('A', [created('task', newTask({ title: 'Old', order: 'a' }))])
    const task = newTask({ title: 'Together', order: 'b' })
    inShared('task', task)
    sync.push('A', [created('task', newTask({ title: 'New', order: 'c' }))])
    sync.push('A', [edit('task', task.id, { title: 'Together, renamed' })])

    const body = sync.pullSpaces('A', 2)
    expect(body.spaces.some((s) => s.entities)).toBe(false)
    expect(body.spaces.map((s) => titles(s.changes))).toEqual([['New'], ['Together, renamed']])
    expect(body.cursor).toEqual({ [pa]: 3, [shared]: 4 })
    expect(body.removed).toEqual([])
  })

  it('the snapshot gives the cursor per space and keeps the protocol 1 seq', () => {
    sync.push('A', [created('task', newTask({ title: 'A private', order: 'a' }))])
    inShared('task', newTask({ title: 'Together', order: 'b' }))
    sync.push('B', [created('task', newTask({ title: 'B private', order: 'a' }))])

    const snap = sync.snapshot('B')
    expect(snap.cursor).toEqual({ [pb]: 3, [shared]: 2 })
    expect(snap.seq).toBe(3)
    expect(snap.entities.map((e) => [e.data.title, e.spaceId]).sort()).toEqual([
      ['B private', pb],
      ['Together', shared],
    ])
    const one = sync.snapshot('B', null, shared)
    expect(one.spaces.map((s) => s.id)).toEqual([shared])
    expect(one.cursor).toEqual({ [shared]: 2 })
    expect(titles(one.entities)).toEqual(['Together'])
    expect(sync.snapshot('B', null, 'not-mine').spaces).toEqual([])
  })

  it('a push moves the cursor past its own changes, only where nothing else happened', () => {
    const task = newTask({ title: 'Together', order: 'b' })
    inShared('task', task)
    const cursor = sync.pullSpaces('B', {}).cursor

    // Only B wrote: both spaces can move on.
    const first = sync.push(
      'B',
      [
        created('task', newTask({ title: 'Mine', order: 'a' })),
        edit('task', task.id, { notes: 'B was here' }),
      ],
      { cursor },
    )
    expect(first.cursor).toEqual({ [pb]: 2, [shared]: 3 })
    expect(sync.pullSpaces('B', first.cursor ?? {}).spaces.flatMap((s) => s.changes)).toEqual([])

    // A wrote in the shared space in between: that space must still be pulled.
    sync.push('A', [edit('task', task.id, { title: 'By A' })])
    const second = sync.push(
      'B',
      [
        created('task', newTask({ title: 'Mine too', order: 'b' })),
        edit('task', task.id, { notes: 'again' }),
      ],
      { cursor: first.cursor },
    )
    expect(second.cursor).toEqual({ [pb]: 5 })
    const rest = sync.pullSpaces('B', { ...first.cursor, ...second.cursor })
    expect(rest.spaces.flatMap((s) => s.changes).map((c) => c.fields)).toEqual([
      { title: 'By A' },
      { notes: 'again' },
    ])
    // Without a cursor the answer is as before.
    expect(sync.push('B', [edit('task', task.id, { notes: 'x' })])).not.toHaveProperty('cursor')
  })

  it('an agent with a narrow grant gets only what it reaches, in snapshots and changes', () => {
    const work = newArea({ title: 'Work', order: 'a' })
    sync.push('A', [
      created('area', work),
      created('task', newTask({ title: 'In work', areaId: work.id, order: 'a' })),
      created('task', newTask({ title: 'In inbox', order: 'b' })),
    ])
    inShared('task', newTask({ title: 'Together', order: 'c' }))
    const grants = [{ scope: 'area' as const, id: work.id, level: 'read' as const }]

    const first = sync.pullSpaces('A', {}, undefined, grants)
    expect(first.spaces.map((s) => titles(s.entities ?? []).sort())).toEqual([
      ['In work', 'Work'],
      [],
    ])
    expect(
      sync
        .snapshot('A', grants)
        .entities.map((e) => e.data.title)
        .sort(),
    ).toEqual(['In work', 'Work'])

    sync.push('A', [
      created('task', newTask({ title: 'Also work', areaId: work.id, order: 'd' })),
      created('task', newTask({ title: 'Not work', order: 'e' })),
    ])
    const next = sync.pullSpaces('A', first.cursor, undefined, grants)
    expect(next.spaces.flatMap((s) => titles(s.changes))).toEqual(['Also work'])
    // The cursor still covers the page, also past what the agent cannot see.
    expect(next.cursor[pa]).toBe(6)
  })
})

describe('sync per space (HTTP)', () => {
  async function setup() {
    const database = openDatabase(':memory:')
    opened.push(database)
    const app = createApp({
      db: database.db,
      version: 't',
      sqliteVersion: database.sqliteVersion,
      registrationOpen: true,
    })
    const res = await app.request('/api/auth/register', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ email: 'one@example.com', password: 'password123' }),
    })
    const cookie = res.headers.get('set-cookie')?.split(';')[0] ?? ''
    const call = (path: string, init: RequestInit = {}) =>
      app.request(path, {
        ...init,
        headers: { 'content-type': 'application/json', cookie, ...init.headers },
      })
    return { app, call }
  }

  it('speaks protocol 2 with a cursor, protocol 1 with since, and says which in health', async () => {
    const { app, call } = await setup()
    const health = await (await app.request('/api/health')).json()
    expect(health.syncProtocol).toBe(2)

    const task = newTask({ title: 'Melk', order: 'a' })
    const empty = (await (
      await call(`/api/sync/pull?cursor=${encodeURIComponent('{}')}`)
    ).json()) as PullResponse
    const personal = empty.spaces[0]?.id ?? ''
    expect(empty.spaces).toHaveLength(1)
    expect(empty.cursor).toEqual({ [personal]: 0 })

    const pushed = await call('/api/sync/push', {
      method: 'POST',
      body: JSON.stringify({ changes: [created('task', task)], cursor: empty.cursor }),
    })
    expect(await pushed.json()).toEqual({
      seq: 1,
      applied: 1,
      duplicates: 0,
      cursor: { [personal]: 1 },
    })

    const p2 = (await (
      await call(`/api/sync/pull?cursor=${encodeURIComponent(JSON.stringify({ [personal]: 0 }))}`)
    ).json()) as PullResponse
    expect(titles(p2.spaces[0]?.changes ?? [])).toEqual(['Melk'])
    expect(p2.cursor).toEqual({ [personal]: 1 })

    // The old form: exactly the old shape.
    const p1 = await (await call('/api/sync/pull?since=0')).json()
    expect(Object.keys(p1).sort()).toEqual(['changes', 'hasMore', 'seq'])
    expect(titles(p1.changes)).toEqual(['Melk'])
    expect(p1.seq).toBe(1)
    const p0 = await (await call('/api/sync/pull')).json()
    expect(p0.seq).toBe(1)

    // A protocol 1 cursor moved over in one request.
    const moved = (await (await call('/api/sync/pull?cursor=0')).json()) as PullResponse
    expect(moved.cursor).toEqual({ [personal]: 1 })
    expect(moved.spaces[0]?.entities).toBeUndefined()

    for (const bad of ['nope', '{"x":-1}', '[1]', '1.5', encodeURIComponent('{"x":"1"}')]) {
      const res = await call(`/api/sync/pull?cursor=${bad}`)
      expect(res.status, bad).toBe(400)
    }

    const snap = (await (await call('/api/sync/snapshot')).json()) as SnapshotResponse
    expect(snap).toMatchObject({ protocol: 2, seq: 1, cursor: { [personal]: 1 } })
    expect(snap.entities[0]?.spaceId).toBe(personal)
    const one = await call(`/api/sync/snapshot?space=${personal}`)
    expect(((await one.json()) as SnapshotResponse).entities).toHaveLength(1)
    expect((await call('/api/sync/snapshot?space=someone-else')).status).toBe(404)
  })
})
