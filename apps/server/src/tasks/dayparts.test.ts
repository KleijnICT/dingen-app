import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import {
  type Change,
  createClock,
  newTask,
  reminderMoment,
  type SpaceCursor,
  Task,
  ulid,
} from '@dingen/core'
import { and, eq } from 'drizzle-orm'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { ActivityService } from '../activity/service.js'
import { listBackups } from '../backup.js'
import { migrationsFolder, type OpenedDatabase, openDatabase } from '../db.js'
import { entities, meta } from '../schema.js'
import { createPersonalSpace } from '../spaces/service.js'
import { prepareDatabase } from '../startup.js'
import { SyncService } from '../sync.js'
import { convertToDayparts, DAYPARTS_KEY, migrateDayparts } from './dayparts.js'

const clock = createClock('DPTEST')
const DATE = { kind: 'date', date: '2026-11-20' } as const

function create(task: Task): Change {
  const { id, ...fields } = task
  return { id: ulid(), entityType: 'task', entityId: id, fields, ts: clock.now(), clientId: 'T' }
}

function addUser(db: OpenedDatabase, id: string): string {
  db.sqlite
    .prepare("insert into users (id, email, password_hash, created_at) values (?, ?, 'x', ?)")
    .run(id, `${id.toLowerCase()}@example.com`, '2026-01-01T00:00:00.000Z')
  return createPersonalSpace(db.db, id, '2026-01-01T00:00:00.000Z')
}

function stored(db: OpenedDatabase, id: string) {
  return db.db
    .select()
    .from(entities)
    .where(and(eq(entities.entityType, 'task'), eq(entities.id, id)))
    .get()
}

/**
 * A task as a protocol 2 server stored it: pushed in protocol 3 shape, then
 * given `evening` and `time` (with stamps) straight in the row.
 */
function oldTask(
  db: OpenedDatabase,
  userId: string,
  legacy: { evening?: boolean; time?: string | null },
  fields: Partial<Task> = {},
): Task {
  const {
    daypart: _d,
    duration: _u,
    ...task
  } = newTask({ title: 'Old task', when: DATE, ...fields })
  new SyncService(db.db).push(userId, [create(task as Task)])
  const row = stored(db, task.id)
  if (!row) throw new Error('not stored')
  const ts = clock.now()
  const data = { ...row.data, evening: legacy.evening ?? false, time: legacy.time ?? null }
  const fieldTs = { ...row.fieldTs, evening: ts, time: ts }
  db.db
    .update(entities)
    .set({ data, fieldTs })
    .where(and(eq(entities.entityType, 'task'), eq(entities.id, task.id)))
    .run()
  return task as Task
}

/** The task as a client would read it from the stored row. */
const parsed = (db: OpenedDatabase, id: string) => Task.parse(stored(db, id)?.data)

describe('convertToDayparts', () => {
  let database: OpenedDatabase
  let sync: SyncService
  let personal: string

  beforeEach(() => {
    database = openDatabase(':memory:')
    sync = new SyncService(database.db)
    personal = addUser(database, 'A')
  })

  afterEach(() => database.close())

  it('turns evening and time into dayparts and removes the old fields', () => {
    const evening = oldTask(database, 'A', { evening: true })
    const morning = oldTask(database, 'A', { time: '09:30' })
    const afternoon = oldTask(database, 'A', { time: '12:00' })
    const late = oldTask(database, 'A', { time: '18:00' })
    const plain = oldTask(database, 'A', {})

    const result = convertToDayparts(database.db)
    expect(result).toEqual({ spaces: 1, evening: 1, timed: 3, reminders: 3, cleaned: 5 })

    expect(parsed(database, evening.id)).toMatchObject({ daypart: 'evening', reminder: null })
    expect(parsed(database, morning.id).daypart).toBe('morning')
    expect(parsed(database, afternoon.id).daypart).toBe('afternoon')
    expect(parsed(database, late.id).daypart).toBe('evening')
    expect(parsed(database, plain.id)).toMatchObject({ daypart: null, duration: null })
    for (const task of [evening, morning, afternoon, late, plain]) {
      const row = stored(database, task.id)
      expect(row?.data).not.toHaveProperty('evening')
      expect(row?.data).not.toHaveProperty('time')
      expect(row?.fieldTs).not.toHaveProperty('evening')
      expect(row?.fieldTs).not.toHaveProperty('time')
      // The stored task is valid protocol 3 data.
      expect(Task.strict().safeParse(row?.data).success).toBe(true)
    }

    // A second run finds nothing to do.
    expect(convertToDayparts(database.db)).toEqual({
      spaces: 0,
      evening: 0,
      timed: 0,
      reminders: 0,
      cleaned: 0,
    })
  })

  it('keeps every reminder at exactly the same moment', () => {
    const reminders = [
      // Followed the task's time.
      { time: '09:30', reminder: { daysBefore: 0, time: '09:30' } },
      // Set apart from the time.
      { time: '14:00', reminder: { daysBefore: 1, time: '20:00' } },
      // No time at all.
      { time: null, reminder: { daysBefore: 2, time: '07:15' } },
      // In the evening, with a reminder before it.
      { time: '19:30', reminder: { daysBefore: 0, time: '18:45' }, evening: true },
    ]
    const tasks = reminders.map(({ time, reminder, evening }) =>
      oldTask(database, 'A', { time, evening: evening ?? false }, { reminder }),
    )
    const before = tasks.map((t) => reminderMoment(parsed(database, t.id)))
    expect(before.every((m) => m !== null)).toBe(true)

    convertToDayparts(database.db)
    expect(tasks.map((t) => reminderMoment(parsed(database, t.id)))).toEqual(before)
    expect(tasks.map((t) => parsed(database, t.id).daypart)).toEqual([
      'morning',
      'afternoon',
      null,
      'evening',
    ])
  })

  it('gives a task with a time but no reminder a reminder at that time on the day', () => {
    const task = oldTask(database, 'A', { time: '16:45' })
    convertToDayparts(database.db)
    expect(parsed(database, task.id).reminder).toEqual({ daysBefore: 0, time: '16:45' })
    expect(reminderMoment(parsed(database, task.id))).toEqual({
      date: '2026-11-20',
      time: '16:45',
    })
  })

  it('cleans deleted tasks and tasks without a date without adding anything', () => {
    const gone = oldTask(database, 'A', { time: '10:00' }, { deleted: true })
    const someday = oldTask(database, 'A', { time: '10:00' }, { when: { kind: 'someday' } })
    const result = convertToDayparts(database.db)
    expect(result).toMatchObject({ timed: 0, reminders: 0, cleaned: 2 })
    expect(stored(database, gone.id)?.data).not.toHaveProperty('time')
    expect(parsed(database, someday.id)).toMatchObject({ daypart: null, reminder: null })
  })

  it('writes the changes to the log with system as actor, so clients pull them', () => {
    const task = oldTask(database, 'A', { evening: true, time: '20:00' })
    const seq = Number(
      (database.sqlite.prepare('select max(seq) as seq from changes').get() as { seq: number }).seq,
    )
    const cursor: SpaceCursor = { [personal]: seq }
    convertToDayparts(database.db)

    const space = sync.pullSpaces('A', cursor).spaces.find((s) => s.id === personal)
    expect(space?.changes.map((c) => [c.entityId, c.fields])).toEqual([
      [task.id, { daypart: 'evening', reminder: { daysBefore: 0, time: '20:00' } }],
    ])
    const actors = database.sqlite.prepare('select actor from changes where seq > ?').all(seq)
    expect(actors).toEqual([{ actor: 'system' }])
    const line = new ActivityService(database.db)
      .list('A')
      .items.find((i) => i.entityId === task.id && i.kind === 'updated')
    expect(line?.actor).toBe('system')
  })

  it('leaves tasks that can be changed afterwards', () => {
    const task = oldTask(database, 'A', { time: '08:00' })
    convertToDayparts(database.db)
    const result = sync.push('A', [
      {
        id: ulid(),
        entityType: 'task',
        entityId: task.id,
        fields: { title: 'Renamed', duration: 30 },
        ts: clock.now(),
        clientId: 'T',
      },
    ])
    expect(result.applied).toBe(1)
    expect(parsed(database, task.id)).toMatchObject({ title: 'Renamed', duration: 30 })
  })

  it('runs once at start and records it in meta', () => {
    oldTask(database, 'A', { evening: true })
    const first = migrateDayparts(database.db, new Date('2026-11-16T12:00:00.000Z'))
    expect(first).toMatchObject({ spaces: 1, evening: 1 })
    const row = database.db.select().from(meta).where(eq(meta.key, DAYPARTS_KEY)).get()
    expect(JSON.parse(row?.value ?? '{}')).toMatchObject({
      at: '2026-11-16T12:00:00.000Z',
      evening: 1,
    })
    expect(migrateDayparts(database.db)).toBeNull()
  })
})

describe('the dayparts migration at start', () => {
  let dir: string

  beforeEach(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'dingen-dayparts-'))
  })

  afterEach(() => {
    fs.rmSync(dir, { recursive: true, force: true })
  })

  it('makes a backup first, then converts', async () => {
    const options = {
      databasePath: path.join(dir, 'dingen.db'),
      backupDir: path.join(dir, 'backups'),
      migrationsFolder,
      log: { log: () => {}, error: () => {} },
    }
    // A database from before dayparts: everything done except this migration.
    const first = await prepareDatabase(options)
    addUser(first, 'A')
    const task = oldTask(first, 'A', { time: '13:15' })
    first.sqlite.prepare('delete from meta where key = ?').run(DAYPARTS_KEY)
    first.close()

    const second = await prepareDatabase(options)
    try {
      expect(listBackups(options.backupDir)).toHaveLength(1)
      expect(parsed(second, task.id)).toMatchObject({
        daypart: 'afternoon',
        reminder: { daysBefore: 0, time: '13:15' },
      })
      expect(
        second.sqlite.prepare('select 1 from meta where key = ?').get(DAYPARTS_KEY),
      ).toBeTruthy()
    } finally {
      second.close()
    }
  })
})
