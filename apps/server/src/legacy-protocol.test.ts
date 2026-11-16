import {
  type Change,
  createClock,
  newTask,
  PROTOCOL_HEADER,
  type PullResponse,
  reminderMoment,
  type SnapshotResponse,
  Task,
  TimeOfDay,
  ulid,
} from '@dingen/core'
import { afterEach, describe, expect, it } from 'vitest'
import { createApp } from './app.js'
import { type OpenedDatabase, openDatabase } from './db.js'
import { parseExport, upgradeTaskRecord } from './export.js'

/** The move from sync protocol 2 to 3 (plan 25): old clients keep working. */

const clock = createClock('LEGACY')
const opened: OpenedDatabase[] = []
const DATE = { kind: 'date', date: '2026-11-20' } as const

afterEach(() => {
  for (const d of opened.splice(0)) d.close()
})

/** The task schema of a protocol 2 client (not strict: unknown fields are dropped). */
const OldTask = Task.omit({ daypart: true, duration: true }).extend({
  evening: Task.shape.deleted,
  time: TimeOfDay.nullable().default(null),
})

/** A task as a protocol 2 client makes it. */
function oldTask(fields: Record<string, unknown> = {}): Record<string, unknown> {
  const { daypart: _d, duration: _u, ...task } = newTask({ title: 'Old client', when: DATE })
  return { ...task, evening: false, time: null, ...fields }
}

function change(entityId: string, fields: Record<string, unknown>): Change {
  return { id: ulid(), entityType: 'task', entityId, fields, ts: clock.now(), clientId: 'OLD' }
}

function created(task: Record<string, unknown>): Change {
  const { id, ...fields } = task
  return change(id as string, fields)
}

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
  /** A request as a client of `protocol` makes it: 2 sends no protocol header. */
  const call = (protocol: 2 | 3, path: string, init: RequestInit = {}) =>
    app.request(path, {
      ...init,
      headers: {
        'content-type': 'application/json',
        cookie,
        ...(protocol === 3 ? { [PROTOCOL_HEADER]: '3' } : {}),
        ...init.headers,
      },
    })
  const push = async (protocol: 2 | 3, changes: Change[]) => {
    const res = await call(protocol, '/api/sync/push', {
      method: 'POST',
      body: JSON.stringify({ changes }),
    })
    expect(res.status).toBe(200)
  }
  const snapshot = async (protocol: 2 | 3) =>
    (await (await call(protocol, '/api/sync/snapshot')).json()) as SnapshotResponse
  const taskOf = async (id: string) => {
    const rec = (await snapshot(3)).entities.find((e) => e.id === id)
    return Task.strict().parse(rec?.data)
  }
  return { call, push, snapshot, taskOf }
}

describe('a protocol 2 client pushing', () => {
  it('creates a task with evening and time as a daypart (its own reminder field wins)', async () => {
    const { push, taskOf } = await setup()
    const task = oldTask({ evening: true, time: '10:00' })
    await push(2, [created(task)])
    expect(await taskOf(task.id as string)).toMatchObject({
      daypart: 'evening',
      duration: null,
      reminder: null,
    })
  })

  it('sets a time on a task without a reminder as its daypart plus a reminder', async () => {
    const { push, taskOf } = await setup()
    const task = oldTask()
    await push(2, [created(task)])
    await push(2, [change(task.id as string, { time: '10:00' })])
    expect(await taskOf(task.id as string)).toMatchObject({
      daypart: 'morning',
      reminder: { daysBefore: 0, time: '10:00' },
    })
  })

  it('sets a time as its daypart, without touching a reminder it already has', async () => {
    const { push, taskOf } = await setup()
    const reminder = { daysBefore: 1, time: '20:00' }
    const task = oldTask({ reminder })
    await push(2, [created(task)])
    await push(2, [change(task.id as string, { time: '14:30' })])
    expect(await taskOf(task.id as string)).toMatchObject({ daypart: 'afternoon', reminder })
  })

  it('turns evening off only for an evening daypart', async () => {
    const { push, taskOf } = await setup()
    const morning = newTask({ title: 'New client', when: DATE, daypart: 'morning' })
    const evening = newTask({ title: 'New client', when: DATE, daypart: 'evening' })
    await push(3, [created({ ...morning }), created({ ...evening })])
    await push(2, [change(morning.id, { evening: false }), change(evening.id, { evening: false })])
    expect((await taskOf(morning.id)).daypart).toBe('morning')
    expect((await taskOf(evening.id)).daypart).toBeNull()
  })

  it('converts a change to a task made earlier in the same batch', async () => {
    const { push, taskOf } = await setup()
    const task = oldTask({ reminder: { daysBefore: 0, time: '07:00' } })
    await push(2, [created(task), change(task.id as string, { time: '19:00' })])
    expect(await taskOf(task.id as string)).toMatchObject({
      daypart: 'evening',
      reminder: { daysBefore: 0, time: '07:00' },
    })
  })

  it('still gets a malformed time refused', async () => {
    const { call } = await setup()
    const res = await call(2, '/api/sync/push', {
      method: 'POST',
      body: JSON.stringify({ changes: [created(oldTask({ time: '25:00' }))] }),
    })
    expect(res.status).toBe(400)
  })
})

describe('a protocol 2 client pulling', () => {
  it('gets tasks with a derived evening and no time, which its schema accepts', async () => {
    const { push, snapshot } = await setup()
    const task = newTask({
      title: 'New client',
      when: DATE,
      daypart: 'evening',
      duration: 30,
      reminder: { daysBefore: 0, time: '19:00' },
    })
    await push(3, [created({ ...task })])

    const old = (await snapshot(2)).entities.find((e) => e.id === task.id)
    expect(old?.data).toMatchObject({ evening: true, time: null, daypart: 'evening' })
    const parsed = OldTask.safeParse(old?.data)
    expect(parsed.success).toBe(true)
    expect(parsed.data).toMatchObject({ evening: true, time: null })
    expect(parsed.data).not.toHaveProperty('daypart')

    // A protocol 3 client gets the task as it is.
    const current = (await snapshot(3)).entities.find((e) => e.id === task.id)
    expect(current?.data).not.toHaveProperty('evening')
    expect(current?.data).not.toHaveProperty('time')
  })

  it('gets daypart changes with evening, in both pull forms', async () => {
    const { call, push } = await setup()
    const task = newTask({ title: 'New client', when: DATE })
    const empty = (await (
      await call(2, `/api/sync/pull?cursor=${encodeURIComponent('{}')}`)
    ).json()) as PullResponse
    await push(3, [created({ ...task })])
    await push(3, [change(task.id, { daypart: 'evening' })])

    const cursor = encodeURIComponent(JSON.stringify(empty.cursor))
    const spaces = (await (await call(2, `/api/sync/pull?cursor=${cursor}`)).json()) as PullResponse
    const fields = spaces.spaces.flatMap((s) => s.changes.map((c) => c.fields))
    expect(fields[0]).toMatchObject({ evening: false, time: null })
    expect(fields[1]).toEqual({ daypart: 'evening', evening: true, time: null })

    const since = (await (await call(2, '/api/sync/pull?since=0')).json()) as {
      changes: Change[]
    }
    expect(since.changes.map((c) => c.fields.evening)).toEqual([false, true])

    const modern = (await (await call(3, `/api/sync/pull?cursor=${cursor}`)).json()) as PullResponse
    expect(modern.spaces[0]?.changes[1]?.fields).toEqual({ daypart: 'evening' })
  })

  it('gets a new space whole, with evening on its tasks', async () => {
    const { call, push } = await setup()
    const task = newTask({ title: 'New client', when: DATE, daypart: 'evening' })
    await push(3, [created({ ...task })])
    const body = (await (
      await call(2, `/api/sync/pull?cursor=${encodeURIComponent('{}')}`)
    ).json()) as PullResponse
    expect(body.spaces[0]?.entities?.[0]?.data).toMatchObject({ evening: true, time: null })
  })
})

describe('importing an export file from before dayparts', () => {
  const ts = clock.now()
  const record = (data: Record<string, unknown>) => ({
    id: data.id as string,
    data,
    fieldTs: Object.fromEntries(
      Object.keys(data)
        .filter((k) => k !== 'id')
        .map((k) => [k, ts]),
    ),
  })

  it('converts evening and time as the migration does', () => {
    const reminder = { daysBefore: 1, time: '20:00' }
    const evening = oldTask({ evening: true })
    const timed = oldTask({ time: '08:15' })
    const withReminder = oldTask({ time: '15:00', reminder })
    const file = {
      format: 'dingen-export',
      version: 2,
      spaces: [],
      entities: { task: [record(evening), record(timed), record(withReminder)] },
    }
    const parsed = parseExport(file)
    if (!parsed.ok) throw new Error(parsed.issues.join('; '))
    const byId = new Map(parsed.records.map((r) => [r.id, r]))
    const task = (id: unknown) => Task.strict().parse(byId.get(id as string)?.data)
    expect(task(evening.id)).toMatchObject({ daypart: 'evening', reminder: null })
    expect(task(timed.id)).toMatchObject({
      daypart: 'morning',
      reminder: { daysBefore: 0, time: '08:15' },
    })
    expect(task(withReminder.id)).toMatchObject({ daypart: 'afternoon', reminder })
    // The reminder that was there goes off at the same moment.
    expect(reminderMoment(task(withReminder.id))).toEqual({ date: '2026-11-19', time: '20:00' })
    const stamps = byId.get(timed.id as string)?.fieldTs ?? {}
    expect(stamps).not.toHaveProperty('evening')
    expect(stamps).not.toHaveProperty('time')
    expect(stamps.daypart).toBe(ts)
    expect(stamps.reminder).toBe(ts)
  })

  it('converts a version 1 file too, and refuses evening in a version 3 file', () => {
    const task = oldTask({ evening: true })
    const v1 = parseExport({
      format: 'dingen-export',
      version: 1,
      entities: { task: [record(task)] },
    })
    expect(v1.ok && v1.records[0]?.data.daypart).toBe('evening')
    const v3 = parseExport({
      format: 'dingen-export',
      version: 3,
      spaces: [],
      entities: { task: [record(task)] },
    })
    expect(v3.ok).toBe(false)
  })

  it('leaves a record without the old fields alone', () => {
    const rec = { data: { id: 'x', title: 'y' }, fieldTs: { title: ts } }
    expect(upgradeTaskRecord(rec)).toBe(rec)
  })

  it('imports over HTTP into protocol 3 tasks', async () => {
    const { call, taskOf } = await setup()
    const task = oldTask({ time: '21:00' })
    const res = await call(3, '/api/import?mode=merge', {
      method: 'POST',
      body: JSON.stringify({
        format: 'dingen-export',
        version: 2,
        spaces: [],
        entities: { task: [record(task)] },
      }),
    })
    expect(res.status).toBe(200)
    expect(await taskOf(task.id as string)).toMatchObject({
      daypart: 'evening',
      reminder: { daysBefore: 0, time: '21:00' },
    })
  })
})
