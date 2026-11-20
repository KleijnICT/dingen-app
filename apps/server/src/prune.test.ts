import {
  type Change,
  CursorAheadError,
  createClock,
  type EntityType,
  newProject,
  newTask,
  ulid,
} from '@dingen/core'
import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { ActivityService } from './activity/service.js'
import { openDatabase } from './db.js'
import { buildExport } from './export.js'
import {
  ChangeLogPruner,
  PRUNE_FLOOR_KEY,
  PRUNED_AT_KEY,
  pruneChanges,
  readFloors,
  retentionCutoff,
} from './prune.js'
import { createPersonalSpace } from './spaces/service.js'
import { SyncService } from './sync.js'

const database = openDatabase(':memory:')
const { sqlite } = database
const sync = new SyncService(database.db)
const activity = new ActivityService(database.db)
const USER = 'U1'
sqlite
  .prepare(
    "insert into users (id, email, password_hash, created_at) values (?, 'u1@example.com', 'x', '2024-01-01T00:00:00.000Z')",
  )
  .run(USER)
const SPACE = createPersonalSpace(database.db, USER, '2024-01-01T00:00:00.000Z')
/** A second space that only has old changes. */
const QUIET = 'S-QUIET'
sqlite
  .prepare(
    "insert into spaces (id, kind, owner_id, created_at) values (?, 'shared', ?, '2024-01-01')",
  )
  .run(QUIET, USER)
sqlite
  .prepare(
    "insert into space_members (space_id, user_id, level, joined_at) values (?, ?, 'manage', '2024-01-01')",
  )
  .run(QUIET, USER)

const NOW = new Date('2026-11-20T12:00:00.000Z')
const OLD = '2025-06-01T09:00:00.000Z'
const RECENT = '2026-10-01T09:00:00.000Z'
const clock = createClock('TEST')

afterAll(() => database.close())
beforeEach(() => {
  sqlite.exec('delete from changes; delete from entities; delete from meta;')
})

/** Writes one change, received at `at`; returns its seq. */
function write(
  entityType: EntityType,
  entityId: string,
  fields: Record<string, unknown>,
  at: string,
): number {
  const change: Change = {
    id: ulid(),
    entityType,
    entityId,
    fields,
    ts: clock.now(),
    clientId: 'T',
  }
  return sync.push(USER, [change], { receivedAt: at }).seq
}

function createTask(title: string, at: string, spaceId?: string): string {
  const { id, ...fields } = newTask({ title })
  write('task', id, spaceId ? { ...fields, spaceId } : fields, at)
  return id
}

const count = () => (sqlite.prepare('select count(*) as n from changes').get() as { n: number }).n
const entityRows = () =>
  sqlite.prepare('select * from entities order by entity_type, id').all() as unknown[]

/**
 * A year and a half of history: a task made and edited long ago, a project
 * deleted long ago (a tombstone), a quiet space with one old task, and recent
 * work. Returns the seqs that matter.
 */
function history() {
  const old = createTask('Old task', OLD)
  write('task', old, { title: 'Old task, renamed' }, OLD)
  const { id: projectId, ...project } = newProject({ title: 'Gone' })
  write('project', projectId, project, OLD)
  write('project', projectId, { deleted: true }, OLD)
  const quiet = createTask('Quiet task', OLD, QUIET)
  const lastOld = write('task', quiet, { notes: 'still here' }, OLD)
  const firstRecent = write('task', old, { title: 'Old task, touched' }, RECENT)
  const recent = createTask('Recent task', RECENT)
  const lastRecent = write('task', recent, { title: 'Recent task, renamed' }, RECENT)
  return { old, quiet, recent, projectId, lastOld, firstRecent, lastRecent }
}

describe('pruneChanges', () => {
  it('removes changes older than a year and keeps the recent ones', async () => {
    const h = history()
    const before = count()
    const { removed, floors } = await pruneChanges(sqlite, { now: NOW, pause: async () => {} })
    // All six old rows but the newest of the quiet space.
    expect(removed).toBe(5)
    expect(count()).toBe(before - 5)
    const left = (
      sqlite.prepare('select seq from changes order by seq').all() as { seq: number }[]
    ).map((r) => r.seq)
    expect(left).toEqual([h.lastOld, h.firstRecent, h.firstRecent + 1, h.lastRecent])
    // The quiet space keeps its newest row, so its highest seq does not change.
    expect(floors[QUIET]).toBe(h.lastOld - 1)
    expect(floors[SPACE]).toBe(h.lastOld - 2)
    expect(readFloors(sqlite)).toEqual(floors)
    expect(
      (
        sqlite.prepare('select value from meta where key = ?').get(PRUNED_AT_KEY) as {
          value: string
        }
      ).value,
    ).toBe(NOW.toISOString())
  })

  it('leaves entity state, snapshots and export exactly as they were', async () => {
    const h = history()
    const entitiesBefore = entityRows()
    const snapshotBefore = sync.snapshot(USER)
    const exportBefore = buildExport(database.db, USER, 'test', NOW)
    await pruneChanges(sqlite, { now: NOW, pause: async () => {} })
    expect(entityRows()).toEqual(entitiesBefore)
    expect(sync.snapshot(USER)).toEqual(snapshotBefore)
    expect(buildExport(database.db, USER, 'test', NOW)).toEqual(exportBefore)
    // The tombstone of the deleted project stays, with its per-field stamps.
    const gone = sqlite
      .prepare("select deleted, field_ts from entities where entity_type = 'project' and id = ?")
      .get(h.projectId) as { deleted: number; field_ts: string }
    expect(gone.deleted).toBe(1)
    expect(Object.keys(JSON.parse(gone.field_ts))).toContain('deleted')
  })

  it('keeps last-writer-wins working on pruned entities', async () => {
    const h = history()
    await pruneChanges(sqlite, { now: NOW, pause: async () => {} })
    // A late change with an old stamp loses against what the entity has.
    const stale: Change = {
      id: ulid(),
      entityType: 'task',
      entityId: h.old,
      fields: { title: 'stale' },
      ts: '000000000000001:00000:STALE',
      clientId: 'STALE',
    }
    sync.push(USER, [stale], { receivedAt: NOW.toISOString() })
    expect(sync.current(USER, 'task', h.old)?.data.title).toBe('Old task, touched')
    write('task', h.old, { title: 'new' }, NOW.toISOString())
    expect(sync.current(USER, 'task', h.old)?.data.title).toBe('new')
  })

  it('works in small batches and is a no-op the second time', async () => {
    history()
    const pause = vi.fn(async () => {})
    const first = await pruneChanges(sqlite, { now: NOW, batchSize: 2, pause })
    expect(first.removed).toBe(5)
    expect(pause).toHaveBeenCalled()
    const second = await pruneChanges(sqlite, { now: NOW, pause: async () => {} })
    expect(second.removed).toBe(0)
    expect(second.floors).toEqual(first.floors)
  })

  it('removes nothing when everything is recent', async () => {
    createTask('A', RECENT)
    createTask('B', RECENT)
    expect((await pruneChanges(sqlite, { now: NOW, pause: async () => {} })).removed).toBe(0)
    expect(readFloors(sqlite)).toEqual({})
  })

  it('drops floors of spaces that no longer exist', async () => {
    sqlite
      .prepare('insert into meta (key, value) values (?, ?)')
      .run(PRUNE_FLOOR_KEY, JSON.stringify({ gone: 5 }))
    history()
    const { floors } = await pruneChanges(sqlite, { now: NOW, pause: async () => {} })
    expect(floors.gone).toBeUndefined()
    expect(readFloors(sqlite).gone).toBeUndefined()
  })

  it('cuts off at one year', () => {
    expect(retentionCutoff(NOW).toISOString()).toBe('2025-11-20T12:00:00.000Z')
  })
})

describe('sync after pruning', () => {
  async function pruned() {
    const h = history()
    await pruneChanges(sqlite, { now: NOW, pause: async () => {} })
    return h
  }

  it('protocol 2: a cursor below the floor gets a snapshot marked resync', async () => {
    const h = await pruned()
    const body = sync.pullSpaces(USER, { [SPACE]: 1, [QUIET]: h.lastOld })
    const personal = body.spaces.find((s) => s.id === SPACE)
    expect(personal?.resync).toBe(true)
    expect(personal?.entities?.map((e) => e.data.title).sort()).toEqual([
      'Old task, touched',
      'Recent task, renamed',
    ])
    expect(personal?.seq).toBe(h.lastRecent)
    // The quiet space's cursor is at its newest row: nothing to do there.
    const quiet = body.spaces.find((s) => s.id === QUIET)
    expect(quiet?.resync).toBeUndefined()
    expect(quiet?.entities).toBeUndefined()
    expect(quiet?.changes).toEqual([])
    // A cursor of 0 has seen nothing: also a snapshot.
    const zero = sync.pullSpaces(USER, { [SPACE]: 0, [QUIET]: 0 })
    expect(zero.spaces.every((s) => s.resync === true)).toBe(true)
  })

  it('protocol 2: a recent cursor gets a normal delta', async () => {
    const h = await pruned()
    const body = sync.pullSpaces(USER, { [SPACE]: h.firstRecent, [QUIET]: h.lastOld })
    const personal = body.spaces.find((s) => s.id === SPACE)
    expect(personal?.resync).toBeUndefined()
    expect(personal?.entities).toBeUndefined()
    expect(personal?.changes).toHaveLength(2)
    expect(body.cursor[SPACE]).toBe(h.lastRecent)
    // Exactly at the floor: every pruned row was seen, so a delta too.
    const floor = readFloors(sqlite)[SPACE] as number
    const atFloor = sync.pullSpaces(USER, { [SPACE]: floor, [QUIET]: h.lastOld })
    expect(atFloor.spaces.find((s) => s.id === SPACE)?.resync).toBeUndefined()
  })

  it('protocol 2: a number cursor below a floor resyncs that space', async () => {
    const h = await pruned()
    const body = sync.pullSpaces(USER, 2)
    expect(body.spaces.every((s) => s.resync === true)).toBe(true)
    const recent = sync.pullSpaces(USER, h.lastOld)
    expect(recent.spaces.some((s) => s.resync)).toBe(false)
  })

  it('protocol 1: a cursor below the floor must take a snapshot', async () => {
    const h = await pruned()
    expect(() => sync.pull(USER, 1)).toThrow(CursorAheadError)
    expect(() => sync.pull(USER, 0)).toThrow(CursorAheadError)
    const snapshot = sync.snapshot(USER)
    const after = sync.pull(USER, snapshot.seq)
    expect(after.changes).toEqual([])
    const delta = sync.pull(USER, h.lastOld)
    expect(delta.changes).toHaveLength(3)
    expect(delta.seq).toBe(h.lastRecent)
  })

  it('push: a cursor below the floor is not moved past the pushed changes', async () => {
    const h = await pruned()
    const { id, ...fields } = newTask({ title: 'Pushed' })
    const change: Change = {
      id: ulid(),
      entityType: 'task',
      entityId: id,
      fields,
      ts: clock.now(),
      clientId: 'T',
    }
    const stale = sync.push(USER, [change], { cursor: { [SPACE]: 1 } })
    expect(stale.cursor).toEqual({})
    const { id: id2, ...fields2 } = newTask({ title: 'Pushed again' })
    const next: Change = {
      id: ulid(),
      entityType: 'task',
      entityId: id2,
      fields: fields2,
      ts: clock.now(),
      clientId: 'T',
    }
    const fresh = sync.push(USER, [next], { cursor: { [SPACE]: stale.seq } })
    expect(fresh.cursor).toEqual({ [SPACE]: fresh.seq })
    expect(h.lastRecent).toBeLessThan(stale.seq)
  })
})

describe('activity after pruning', () => {
  it('lists what is left, without the pruned history', async () => {
    const h = history()
    await pruneChanges(sqlite, { now: NOW, pause: async () => {} })
    const { items, nextBefore } = activity.list(USER, { limit: 100 })
    expect(nextBefore).toBeNull()
    const titles = items.map((i) => `${i.kind}:${i.title}`)
    expect(titles).toContain('added:Recent task, renamed')
    // The old task's creation is gone; its recent edit still shows, without a `from`.
    const touched = items.find((i) => i.entityId === h.old)
    expect(touched?.kind).toBe('updated')
    expect(touched?.fields).toEqual([{ field: 'title', from: null, to: 'Old task, touched' }])
    expect(items.some((i) => i.entityId === h.projectId)).toBe(false)
    // Paging into the pruned range just ends.
    expect(activity.list(USER, { before: h.lastOld }).items).toEqual([])
  })
})

describe('ChangeLogPruner', () => {
  const at = (iso: string) => Date.parse(iso)

  it('runs when it never ran, then once a day from 03:00', async () => {
    history()
    let now = at('2026-11-20T03:30:00.000Z')
    const log = vi.spyOn(console, 'log').mockImplementation(() => {})
    const pruner = new ChangeLogPruner(sqlite, { timezone: 'UTC', now: () => now })
    expect(pruner.due()).toBe(true)
    expect((await pruner.tick())?.removed).toBe(5)
    expect(log).toHaveBeenCalledWith(expect.stringContaining('5 change(s)'))
    expect(pruner.due()).toBe(false)
    now = at('2026-11-20T23:00:00.000Z')
    expect(pruner.due()).toBe(false)
    now = at('2026-11-21T02:00:00.000Z')
    expect(pruner.due()).toBe(false)
    now = at('2026-11-21T03:00:00.000Z')
    expect(pruner.due()).toBe(true)
    expect((await pruner.tick())?.removed).toBe(0)
    expect(await pruner.tick()).toBeNull()
    log.mockRestore()
  })

  it('runs at startup when overdue, also before 03:00', () => {
    sqlite
      .prepare('insert into meta (key, value) values (?, ?)')
      .run(PRUNED_AT_KEY, '2026-11-18T03:05:00.000Z')
    const pruner = new ChangeLogPruner(sqlite, {
      timezone: 'UTC',
      now: () => at('2026-11-20T01:00:00.000Z'),
    })
    expect(pruner.due()).toBe(true)
  })

  it('waits for the nightly back-up', () => {
    let pending = true
    const pruner = new ChangeLogPruner(sqlite, {
      timezone: 'UTC',
      now: () => at('2026-11-20T03:00:00.000Z'),
      backupPending: () => pending,
    })
    expect(pruner.due()).toBe(false)
    pending = false
    expect(pruner.due()).toBe(true)
  })
})
