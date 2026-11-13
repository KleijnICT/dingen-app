import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { type Change, createClock, newArea, newTask, ulid } from '@dingen/core'
import { eq } from 'drizzle-orm'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { ActivityService } from '../activity/service.js'
import { createApp } from '../app.js'
import { InvitationService } from '../auth/invitations.js'
import { AuthService } from '../auth/service.js'
import { backupBeforeMigrations } from '../backup.js'
import { migrationsFolder, type OpenedDatabase, openDatabase } from '../db.js'
import { resetToDemo } from '../demo/seed.js'
import { buildExport } from '../export.js'
import { changes, entities, spaceMembers, spaces, users } from '../schema.js'
import { SyncService } from '../sync.js'
import {
  createPersonalSpace,
  levelAllows,
  memberLevel,
  ownedSpacesOf,
  personalSpaceOf,
  SpaceAccessError,
  spacesOf,
} from './service.js'

const clock = createClock('SPACES')
const opened: OpenedDatabase[] = []

function fresh(): OpenedDatabase {
  const database = openDatabase(':memory:')
  opened.push(database)
  return database
}

afterEach(() => {
  for (const d of opened.splice(0)) d.close()
})

function addUser(database: OpenedDatabase, id: string): string {
  database.sqlite
    .prepare("insert into users (id, email, password_hash, created_at) values (?, ?, 'x', ?)")
    .run(id, `${id.toLowerCase()}@example.com`, '2026-01-01T00:00:00.000Z')
  return createPersonalSpace(database.db, id, '2026-01-01T00:00:00.000Z')
}

function created(entityType: 'task' | 'area', entity: { id: string }): Change {
  const { id, ...fields } = entity
  return { id: ulid(), entityType, entityId: id, fields, ts: clock.now(), clientId: 'T' }
}

function edit(entityType: 'task' | 'area', id: string, fields: Record<string, unknown>): Change {
  return { id: ulid(), entityType, entityId: id, fields, ts: clock.now(), clientId: 'T' }
}

/** A shared space (made by hand: inviting comes later) with members at a level. */
function sharedSpace(database: OpenedDatabase, owner: string, others: Record<string, string>) {
  const id = ulid()
  const at = '2026-02-01T00:00:00.000Z'
  database.db.insert(spaces).values({ id, kind: 'shared', ownerId: owner, createdAt: at }).run()
  database.db
    .insert(spaceMembers)
    .values([
      { spaceId: id, userId: owner, level: 'manage', joinedAt: at },
      ...Object.entries(others).map(([userId, level]) => ({
        spaceId: id,
        userId,
        level: level as 'read' | 'edit' | 'manage',
        joinedAt: at,
      })),
    ])
    .run()
  return id
}

/** Puts an entity and its log in another space, as moving will (plan 23, part 3). */
function moveByHand(database: OpenedDatabase, entityId: string, spaceId: string) {
  database.db.update(entities).set({ spaceId }).where(eq(entities.id, entityId)).run()
  database.db.update(changes).set({ spaceId }).where(eq(changes.entityId, entityId)).run()
}

describe('space helpers', () => {
  it('make one personal space with the owner as manage member', () => {
    const database = fresh()
    const space = addUser(database, 'U1')
    expect(personalSpaceOf(database.db, 'U1')).toBe(space)
    expect(space).not.toBe('U1')
    expect(spacesOf(database.db, 'U1')).toEqual([space])
    expect(ownedSpacesOf(database.db, 'U1')).toEqual([space])
    expect(memberLevel(database.db, space, 'U1')).toBe('manage')
    expect(memberLevel(database.db, space, 'U2')).toBeNull()
    expect(personalSpaceOf(database.db, 'nobody')).toBeNull()
    // A second personal space for the same user is refused by the database.
    expect(() => createPersonalSpace(database.db, 'U1', '2026-01-02T00:00:00.000Z')).toThrow(
      /UNIQUE/,
    )
  })

  it('compare levels', () => {
    expect(levelAllows('manage', 'edit')).toBe(true)
    expect(levelAllows('edit', 'edit')).toBe(true)
    expect(levelAllows('read', 'edit')).toBe(false)
    expect(levelAllows('read', 'read')).toBe(true)
    expect(levelAllows(null, 'read')).toBe(false)
  })

  it('go with the user when the user is deleted', () => {
    const database = fresh()
    addUser(database, 'U1')
    database.db.delete(users).where(eq(users.id, 'U1')).run()
    expect(database.db.select().from(spaces).all()).toEqual([])
    expect(database.db.select().from(spaceMembers).all()).toEqual([])
  })
})

describe('every way an account is made gives it a personal space', () => {
  const expectPersonal = (database: OpenedDatabase, userId: string) => {
    const space = personalSpaceOf(database.db, userId)
    expect(space).not.toBeNull()
    expect(spacesOf(database.db, userId)).toEqual([space])
    expect(memberLevel(database.db, space as string, userId)).toBe('manage')
  }

  it('registration (first and open), invitations and Home Assistant', async () => {
    const database = fresh()
    const open = new AuthService(database.db, { registration: 'open' })
    const first = await open.register('first@example.com', 'password123')
    const second = await open.register('second@example.com', 'password123')
    expectPersonal(database, first.id)
    expectPersonal(database, second.id)

    const invite = new AuthService(database.db, { registration: 'invite' })
    const { token } = new InvitationService(database.db).create(first.id)
    const invited = await invite.register('invited@example.com', 'password123', token)
    expectPersonal(database, invited.id)

    const ha = invite.homeAssistantUser({ id: 'ha-user-1', name: 'kim' })
    expectPersonal(database, ha.id)
    // The second visit finds the account; no second space.
    expect(invite.homeAssistantUser({ id: 'ha-user-1', name: 'kim' }).id).toBe(ha.id)
    expect(database.db.select().from(spaces).all()).toHaveLength(4)
  })

  it('a refused registration leaves no space behind', async () => {
    const database = fresh()
    const auth = new AuthService(database.db, { registration: 'closed' })
    await auth.register('first@example.com', 'password123')
    await expect(auth.register('late@example.com', 'password123')).rejects.toThrow()
    expect(database.db.select().from(spaces).all()).toHaveLength(1)
  })

  it('the demo seed, also when it runs again', async () => {
    const database = fresh()
    const now = new Date('2026-11-13T10:00:00.000Z')
    await resetToDemo(database.db, { timezone: 'Europe/Amsterdam', now })
    const result = await resetToDemo(database.db, { timezone: 'Europe/Amsterdam', now })
    expect(database.db.select().from(spaces).all()).toHaveLength(result.users.length)
    const sync = new SyncService(database.db)
    for (const u of result.users) {
      expectPersonal(database, u.id)
      expect(sync.snapshot(u.id).entities.length).toBeGreaterThanOrEqual(u.entities)
      const space = personalSpaceOf(database.db, u.id)
      const rows = database.db.select().from(entities).where(eq(entities.userId, u.id)).all()
      expect(rows.every((r) => r.spaceId === space)).toBe(true)
    }
  })
})

describe('access goes through spaces', () => {
  let database: OpenedDatabase
  let sync: SyncService
  let a: string
  let b: string

  beforeEach(() => {
    database = fresh()
    sync = new SyncService(database.db)
    a = addUser(database, 'A')
    b = addUser(database, 'B')
  })

  it('writes land in the personal space, and nobody else sees them', () => {
    const task = newTask({ title: 'Of A', order: 'a' })
    sync.push('A', [created('task', task)])
    const row = database.db.select().from(entities).where(eq(entities.id, task.id)).get()
    expect(row).toMatchObject({ userId: 'A', spaceId: a })
    expect(database.db.select().from(changes).get()).toMatchObject({ userId: 'A', spaceId: a })

    expect(sync.snapshot('A').entities.map((e) => e.id)).toEqual([task.id])
    expect(sync.snapshot('B').entities).toEqual([])
    expect(sync.pull('B', 0).changes).toEqual([])
    expect(sync.snapshot('B').seq).toBe(0)
    expect(sync.hasEntities('B')).toBe(false)
    expect(buildExport(database.db, 'B', 't').entities.task).toEqual([])
    expect(new ActivityService(database.db).list('B').items).toEqual([])
    expect(sync.lookupFor('B')('task', task.id)).toBeUndefined()
  })

  it("the same id from another user does not touch A's entity", () => {
    const task = newTask({ title: 'Of A', order: 'a' })
    sync.push('A', [created('task', task)])
    sync.push('B', [created('task', { ...task, title: 'Of B' })])
    expect(sync.snapshot('A').entities[0]?.data.title).toBe('Of A')
    expect(sync.snapshot('B').entities[0]?.data.title).toBe('Of B')
    const rows = database.db.select().from(entities).where(eq(entities.id, task.id)).all()
    expect(rows.map((r) => [r.userId, r.spaceId]).sort()).toEqual([
      ['A', a],
      ['B', b],
    ])
  })

  it('a member of a shared space reads it and writes at edit, not at read', () => {
    const shared = sharedSpace(database, 'A', { B: 'read' })
    const task = newTask({ title: 'Together', order: 'a' })
    sync.push('A', [created('task', task)])
    moveByHand(database, task.id, shared)

    // B reads it through the membership, in snapshot, pull and activity.
    expect(sync.snapshot('B').entities.map((e) => e.id)).toEqual([task.id])
    expect(sync.pull('B', 0).changes.map((c) => c.entityId)).toEqual([task.id])
    expect(new ActivityService(database.db).list('B').items).toHaveLength(1)
    // But not in an export: that holds the spaces you own (plan 23).
    expect(buildExport(database.db, 'B', 't').entities.task).toEqual([])
    expect(buildExport(database.db, 'A', 't').entities.task).toHaveLength(1)

    // Read only: a write is refused and nothing changes.
    expect(() => sync.push('B', [edit('task', task.id, { title: 'Mine now' })])).toThrow(
      SpaceAccessError,
    )
    expect(sync.snapshot('A').entities[0]?.data.title).toBe('Together')

    // At edit the write lands in the shared space, on the same row (maker A).
    database.db
      .update(spaceMembers)
      .set({ level: 'edit' })
      .where(eq(spaceMembers.userId, 'B'))
      .run()
    const { seq } = sync.push('B', [edit('task', task.id, { title: 'Edited by B' })])
    expect(sync.snapshot('A').entities[0]?.data.title).toBe('Edited by B')
    const rows = database.db.select().from(entities).where(eq(entities.id, task.id)).all()
    expect(rows).toHaveLength(1)
    expect(rows[0]).toMatchObject({ userId: 'A', spaceId: shared, updatedSeq: seq })
    const last = database.db.select().from(changes).where(eq(changes.seq, seq)).get()
    expect(last).toMatchObject({ userId: 'B', spaceId: shared, actor: 'user:B' })
    // A sees B's change in its pull and its Logbook, by B.
    expect(sync.pull('A', seq - 1).changes.map((c) => c.fields.title)).toEqual(['Edited by B'])
    const items = new ActivityService(database.db).list('A').items
    expect(items[0]?.actor).toBe('user:B')

    // Out of the space: gone for B.
    database.db.delete(spaceMembers).where(eq(spaceMembers.userId, 'B')).run()
    expect(sync.snapshot('B').entities).toEqual([])
    expect(sync.pull('B', 0).changes).toEqual([])
  })

  it('a new entity of a member goes to their own personal space, not the shared one', () => {
    sharedSpace(database, 'A', { B: 'edit' })
    const task = newTask({ title: 'Of B', order: 'a' })
    sync.push('B', [created('task', task)])
    const row = database.db.select().from(entities).where(eq(entities.id, task.id)).get()
    expect(row?.spaceId).toBe(b)
    expect(sync.snapshot('A').entities).toEqual([])
  })

  it('an account without a space cannot write', () => {
    database.sqlite
      .prepare(
        "insert into users (id, email, password_hash, created_at) values ('C', 'c@x', 'x', '')",
      )
      .run()
    expect(() => sync.push('C', [created('task', newTask({ title: 'x', order: 'a' }))])).toThrow(
      SpaceAccessError,
    )
    expect(sync.snapshot('C')).toEqual({
      protocol: 2,
      entities: [],
      spaces: [],
      cursor: {},
      seq: 0,
    })
    expect(sync.pullSpaces('C', {})).toEqual({
      protocol: 2,
      spaces: [],
      removed: [],
      cursor: {},
      hasMore: false,
    })
  })
})

describe('agents reach what their user reaches, never more', () => {
  async function setup() {
    const database = fresh()
    const app = createApp({
      db: database.db,
      version: 't',
      sqliteVersion: database.sqliteVersion,
      registrationOpen: true,
    })
    const sync = new SyncService(database.db)
    const json = { 'content-type': 'application/json' }
    async function account(email: string) {
      const res = await app.request('/api/auth/register', {
        method: 'POST',
        headers: json,
        body: JSON.stringify({ email, password: 'password123' }),
      })
      const cookie = res.headers.get('set-cookie')?.split(';')[0] ?? ''
      const { user } = (await res.json()) as { user: { id: string } }
      return { id: user.id, cookie }
    }
    async function agent(cookie: string, grants: unknown[]) {
      const res = await app.request('/api/agents', {
        method: 'POST',
        headers: { ...json, cookie },
        body: JSON.stringify({ name: 'Bot', icon: 'bot', color: 'gray', grants }),
      })
      return `Bearer ${((await res.json()) as { token: string }).token}`
    }
    return { database, app, sync, account, agent }
  }

  it('with Everything: all spaces of the user, through sync, activity and MCP', async () => {
    const { database, app, sync, account, agent } = await setup()
    const alice = await account('alice@example.com')
    const bob = await account('bob@example.com')
    const own = newTask({ title: 'Bob private', order: 'a' })
    const theirs = newTask({ title: 'Alice private', order: 'a' })
    const together = newTask({ title: 'Shared with Bob', order: 'b' })
    sync.push(bob.id, [created('task', own)])
    sync.push(alice.id, [created('task', theirs), created('task', together)])
    moveByHand(database, together.id, sharedSpace(database, alice.id, { [bob.id]: 'edit' }))

    const everything = await agent(bob.cookie, [{ scope: 'all', level: 'manage' }])
    const snap = await app.request('/api/sync/snapshot', {
      headers: { authorization: everything },
    })
    const titles = ((await snap.json()) as { entities: { data: { title: string } }[] }).entities
      .map((e) => e.data.title)
      .sort()
    expect(titles).toEqual(['Bob private', 'Shared with Bob'])

    const pull = await app.request('/api/sync/pull?since=0', {
      headers: { authorization: everything },
    })
    expect(((await pull.json()) as { changes: unknown[] }).changes).toHaveLength(2)

    const activity = await app.request('/api/activity', { headers: { authorization: everything } })
    const lines = ((await activity.json()) as { items: { title: string }[] }).items
    expect(lines.map((l) => l.title).sort()).toEqual(['Bob private', 'Shared with Bob'])

    const rpc = await app.request('/mcp', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        accept: 'application/json, text/event-stream',
        authorization: everything,
      },
      body: JSON.stringify({
        jsonrpc: '2.0',
        id: 1,
        method: 'tools/call',
        params: { name: 'search', arguments: { query: 'private' } },
      }),
    })
    const raw = await rpc.text()
    expect(raw).toContain('Bob private')
    expect(raw).not.toContain('Alice private')

    // Its writes into the shared space are checked like Bob's: at read, refused.
    database.db
      .update(spaceMembers)
      .set({ level: 'read' })
      .where(eq(spaceMembers.userId, bob.id))
      .run()
    const push = await app.request('/api/sync/push', {
      method: 'POST',
      headers: { 'content-type': 'application/json', authorization: everything },
      body: JSON.stringify({ changes: [edit('task', together.id, { title: 'By the bot' })] }),
    })
    expect(push.status).toBe(403)
    expect(((await push.json()) as { error: string }).error).toBe('space_access')
  })

  it('with a narrow grant: still only what the grant reaches', async () => {
    const { app, sync, account, agent } = await setup()
    const bob = await account('bob@example.com')
    const area = newArea({ title: 'Work', order: 'a' })
    sync.push(bob.id, [
      created('area', area),
      created('task', newTask({ title: 'In work', areaId: area.id, order: 'a' })),
      created('task', newTask({ title: 'In inbox', order: 'b' })),
    ])
    const narrow = await agent(bob.cookie, [{ scope: 'area', id: area.id, level: 'read' }])
    const activity = await app.request('/api/activity', { headers: { authorization: narrow } })
    const lines = ((await activity.json()) as { items: { title: string }[] }).items
    expect(lines.map((l) => l.title).sort()).toEqual(['In work', 'Work'])
  })
})

describe('migration 0008 on an existing database', () => {
  let dir: string
  beforeEach(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'dingen-spaces-'))
  })
  afterEach(() => fs.rmSync(dir, { recursive: true, force: true }))

  it('gives every user a personal space with their data, and keeps them apart', async () => {
    // The migrations of the current release (up to 0007), as an existing install has them.
    const old = path.join(dir, 'drizzle-0007')
    fs.cpSync(migrationsFolder, old, { recursive: true })
    const journalFile = path.join(old, 'meta/_journal.json')
    const journal = JSON.parse(fs.readFileSync(journalFile, 'utf8')) as {
      entries: { tag: string }[]
    }
    journal.entries = journal.entries.filter((e) => e.tag < '0008')
    fs.writeFileSync(journalFile, JSON.stringify(journal))

    const databasePath = path.join(dir, 'data', 'dingen.db')
    const before = openDatabase(databasePath, { migrationsFolder: old })
    const insertUser = before.sqlite.prepare(
      'insert into users (id, email, password_hash, created_at) values (?, ?, ?, ?)',
    )
    insertUser.run('U1', 'one@example.com', 'x', '2026-01-01T00:00:00.000Z')
    insertUser.run('U2', 'two@example.com', 'x', '2026-02-01T00:00:00.000Z')
    insertUser.run('U3', 'empty@example.com', 'x', '2026-03-01T00:00:00.000Z')
    const insertChange = before.sqlite.prepare(
      `insert into changes (user_id, id, client_id, entity_type, entity_id, fields, ts, received_at, actor)
       values (?, ?, 'OLD', ?, ?, ?, ?, '2026-03-01T00:00:00.000Z', null)`,
    )
    const insertEntity = before.sqlite.prepare(
      `insert into entities (user_id, entity_type, id, data, field_ts, deleted, updated_seq)
       values (?, ?, ?, ?, ?, ?, ?)`,
    )
    const counts: Record<string, number> = { U1: 0, U2: 0 }
    // The same entity id for both users is possible (an import of one file into two accounts).
    const sharedId = ulid()
    for (const user of ['U1', 'U2']) {
      const n = user === 'U1' ? 5 : 3
      for (let i = 0; i < n; i++) {
        const task = newTask({ title: `${user} task ${i}`, order: 'a' })
        const id = i === 0 ? sharedId : task.id
        const { id: _, ...fields } = task
        const ts = clock.now()
        const info = insertChange.run(user, ulid(), 'task', id, JSON.stringify(fields), ts)
        const fieldTs = Object.fromEntries(Object.keys(fields).map((k) => [k, ts]))
        insertEntity.run(
          user,
          'task',
          id,
          JSON.stringify({ ...fields, id }),
          JSON.stringify(fieldTs),
          i === n - 1 ? 1 : 0,
          info.lastInsertRowid,
        )
        counts[user] = (counts[user] ?? 0) + 1
      }
    }
    // Changes deleted at the end of the log: the sequence must not be reused.
    before.sqlite.prepare('delete from changes where seq = (select max(seq) from changes)').run()
    const sequence = (
      before.sqlite.prepare("select seq from sqlite_sequence where name = 'changes'").get() as {
        seq: number
      }
    ).seq
    before.close()

    const backup = await backupBeforeMigrations({
      databasePath,
      backupDir: path.join(dir, 'data', 'backups'),
      migrationsFolder,
    })
    expect(backup?.pending).toContain('0008_spaces')

    const after = openDatabase(databasePath)
    opened.push(after)
    const db = after.db
    expect(db.select().from(spaces).all()).toHaveLength(3)
    const sync = new SyncService(db)
    const spaceOf: Record<string, string> = {}
    for (const user of ['U1', 'U2', 'U3']) {
      const space = personalSpaceOf(db, user)
      expect(space).toMatch(/^[0-9A-Z]{26}$/)
      spaceOf[user] = space as string
      expect(spacesOf(db, user)).toEqual([space])
      expect(memberLevel(db, space as string, user)).toBe('manage')
    }
    const created = db.select().from(spaces).where(eq(spaces.ownerId, 'U2')).get()
    expect(created).toMatchObject({ kind: 'personal', createdAt: '2026-02-01T00:00:00.000Z' })

    // Every entity and change is in its user's space.
    for (const row of db.select().from(entities).all()) {
      expect(row.spaceId).toBe(spaceOf[row.userId])
    }
    for (const row of db.select().from(changes).all()) {
      expect(row.spaceId).toBe(spaceOf[row.userId])
    }
    // Counts per user are unchanged, and nobody reads someone else's data.
    expect(db.select().from(entities).where(eq(entities.userId, 'U1')).all()).toHaveLength(
      counts.U1 as number,
    )
    const live = (user: string) => sync.snapshot(user).entities.map((e) => e.data.title as string)
    expect(live('U1')).toHaveLength(4)
    expect(live('U2')).toHaveLength(2)
    expect(live('U1').every((t) => t.startsWith('U1'))).toBe(true)
    expect(live('U2').every((t) => t.startsWith('U2'))).toBe(true)
    expect(live('U3')).toEqual([])
    expect(sync.pull('U1', 0).changes).toHaveLength(5)
    expect(sync.pull('U2', 0).changes).toHaveLength(2)
    expect(sync.pull('U3', 0).changes).toEqual([])

    // Both rows with the shared id survive, each in its own space.
    const pair = db.select().from(entities).where(eq(entities.id, sharedId)).all()
    expect(pair.map((r) => r.spaceId).sort()).toEqual([spaceOf.U1, spaceOf.U2].sort())

    // The log keeps counting where it was; new writes go on as before.
    const { seq } = sync.push('U2', [edit('task', sharedId, { title: 'After' })])
    expect(seq).toBe(sequence + 1)
    expect(live('U1')).not.toContain('After')
    expect(live('U2')).toContain('After')

    // Indexes are there.
    const indexes = (after.sqlite.prepare('pragma index_list(changes)').all() as { name: string }[])
      .map((i) => i.name)
      .concat(
        (after.sqlite.prepare('pragma index_list(entities)').all() as { name: string }[]).map(
          (i) => i.name,
        ),
      )
    expect(indexes).toEqual(
      expect.arrayContaining(['changes_space_seq_idx', 'entities_space_type_id_idx']),
    )
  })
})
