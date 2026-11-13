import { type Change, createClock, newProject, newTask, ulid } from '@dingen/core'
import { eq } from 'drizzle-orm'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { createApp } from './app.js'
import { openDatabase } from './db.js'
import { spaceMembers, spaces, users } from './schema.js'

const clock = createClock('TEST')
const opened: { close: () => void }[] = []
afterAll(() => {
  for (const database of opened) database.close()
})

/** One Dingen installation: its own database and app. */
function server() {
  const database = openDatabase(':memory:')
  opened.push(database)
  const app = createApp({
    db: database.db,
    version: '9.9.9',
    sqliteVersion: database.sqliteVersion,
    registrationOpen: true,
  })

  /** Registers an account and gives a token with the scope Everything (manage). */
  async function account(email: string, grants: unknown[] = [{ scope: 'all', level: 'manage' }]) {
    const res = await app.request('/api/auth/register', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ email, password: 'wachtwoord123' }),
    })
    const cookie = res.headers.get('set-cookie') ?? ''
    const user = database.db.select().from(users).where(eq(users.email, email)).get()
    if (!user) throw new Error('no user')
    return { id: user.id, bearer: await token(cookie, grants), cookie }
  }

  async function token(cookie: string, grants: unknown[]) {
    const res = await app.request('/api/agents', {
      method: 'POST',
      headers: { 'content-type': 'application/json', cookie },
      body: JSON.stringify({ name: `test-${ulid()}`, icon: 'bot', color: 'gray', grants }),
    })
    return `Bearer ${(await res.json()).token}`
  }

  function call(bearer: string, path: string, init: RequestInit = {}) {
    return app.request(path, {
      ...init,
      headers: { 'content-type': 'application/json', authorization: bearer },
    })
  }

  /** A shared space owned by `ownerId`, with other members at a level. */
  function sharedSpace(ownerId: string, members: Record<string, 'read' | 'edit' | 'manage'> = {}) {
    const id = ulid()
    const at = new Date().toISOString()
    database.db.insert(spaces).values({ id, kind: 'shared', ownerId, createdAt: at }).run()
    const all = { [ownerId]: 'manage' as const, ...members }
    for (const [userId, level] of Object.entries(all)) {
      database.db.insert(spaceMembers).values({ spaceId: id, userId, level, joinedAt: at }).run()
    }
    return id
  }

  async function push(bearer: string, changes: Change[]) {
    const res = await call(bearer, '/api/sync/push', {
      method: 'POST',
      body: JSON.stringify({ changes }),
    })
    expect(res.status).toBe(200)
  }

  async function exportOf(bearer: string) {
    const res = await call(bearer, '/api/export')
    expect(res.status).toBe(200)
    return res.json()
  }

  function importFile(bearer: string, file: unknown, mode = 'merge') {
    return call(bearer, `/api/import?mode=${mode}`, { method: 'POST', body: JSON.stringify(file) })
  }

  async function snapshot(bearer: string) {
    const body = await (await call(bearer, '/api/sync/snapshot')).json()
    return {
      spaces: body.spaces as { id: string; kind: string; level: string }[],
      entities: (
        body.entities as {
          entityType: string
          id: string
          spaceId: string
          data: Record<string, unknown>
          fieldTs: Record<string, string>
        }[]
      ).sort((a, b) => (a.id < b.id ? -1 : 1)),
    }
  }

  return { database, app, account, call, sharedSpace, push, exportOf, importFile, snapshot }
}

function create(
  entityType: Change['entityType'],
  entity: { id: string },
  spaceId?: string,
  ts = clock.now(),
): Change {
  const { id, ...fields } = entity
  return {
    id: ulid(),
    entityType,
    entityId: id,
    fields: spaceId ? { ...fields, spaceId } : fields,
    ts,
    clientId: 'TEST',
  }
}

function edit(entityType: Change['entityType'], id: string, fields: Record<string, unknown>) {
  return { id: ulid(), entityType, entityId: id, fields, ts: clock.now(), clientId: 'TEST' }
}

function newTag(title: string) {
  return {
    id: ulid(),
    title,
    parentId: null,
    createdAt: new Date().toISOString(),
    deleted: false,
    order: 'n',
  }
}

/** A file record with one stamp for all fields. */
function fileRecord(entity: { id: string }, spaceId?: string) {
  const stamp = clock.now()
  const fieldTs = Object.fromEntries(
    Object.keys(entity)
      .filter((k) => k !== 'id')
      .map((k) => [k, stamp]),
  )
  return { id: entity.id, ...(spaceId ? { spaceId } : {}), data: entity, fieldTs }
}

// The first installation: Alice owns a shared space, Bob owns one Alice is in.
const one = server()
let alice: Awaited<ReturnType<typeof one.account>>
let bob: Awaited<ReturnType<typeof one.account>>
let aliceShared = ''
let bobShared = ''
const personalTask = newTask({ title: 'Melk kopen' })
const removedTask = newTask({ title: 'Verwijderd' })
const project = newProject({ title: 'Samen verbouwen' })
const sharedTask = newTask({ title: 'Verf kiezen', projectId: project.id })
const sharedTag = newTag('klus')
const ownTag = newTag('klus')
const bobsTask = newTask({ title: 'Van Bob' })

beforeAll(async () => {
  alice = await one.account('alice@test.nl')
  bob = await one.account('bob@test.nl')
  aliceShared = one.sharedSpace(alice.id)
  bobShared = one.sharedSpace(bob.id, { [alice.id]: 'edit' })
  await one.push(alice.bearer, [
    create('task', personalTask),
    create('task', removedTask),
    create('tag', ownTag),
    create('project', project, aliceShared),
    create('tag', sharedTag, aliceShared),
    create('task', { ...sharedTask, tagIds: [sharedTag.id] }, aliceShared),
  ])
  // A later change to one field gets its own stamp.
  await one.push(alice.bearer, [
    edit('task', personalTask.id, { notes: 'Halfvol' }),
    edit('task', removedTask.id, { deleted: true }),
  ])
  await one.push(bob.bearer, [create('task', bobsTask, bobShared)])
})

describe('export', () => {
  it('holds the spaces the user owns, with a spaceId on every record', async () => {
    const res = await one.call(alice.bearer, '/api/export')
    expect(res.headers.get('content-disposition')).toMatch(
      /^attachment; filename="dingen-export-\d{4}-\d{2}-\d{2}\.json"$/,
    )
    const file = await res.json()
    expect(file).toMatchObject({ format: 'dingen-export', version: 2, appVersion: '9.9.9' })
    const personal = file.spaces[0]
    expect(file.spaces).toEqual([
      { id: personal.id, kind: 'personal' },
      { id: aliceShared, kind: 'shared' },
    ])
    expect(personal.id).not.toBe(bobShared)
    const where = (list: { id: string; spaceId: string }[]) =>
      Object.fromEntries(list.map((r) => [r.id, r.spaceId]))
    // Bob's space is not hers to export, deleted entities do not go along.
    expect(where(file.entities.task)).toEqual({
      [personalTask.id]: personal.id,
      [sharedTask.id]: aliceShared,
    })
    expect(where(file.entities.project)).toEqual({ [project.id]: aliceShared })
    expect(where(file.entities.tag)).toEqual({
      [ownTag.id]: personal.id,
      [sharedTag.id]: aliceShared,
    })
    expect(JSON.stringify(file)).not.toMatch(/token|passwordHash|session/i)
  })

  it('asks for authentication, and an agent needs the scope Everything', async () => {
    expect((await one.app.request('/api/export')).status).toBe(401)
    expect((await one.app.request('/api/import', { method: 'POST', body: '{}' })).status).toBe(401)
    const inbox = await one.account('inbox@test.nl', [{ scope: 'inbox', level: 'manage' }])
    expect((await one.call(inbox.bearer, '/api/export')).status).toBe(403)
    const file = await one.exportOf(alice.bearer)
    expect((await one.importFile(inbox.bearer, file)).status).toBe(403)
    // Read on everything may export, not import.
    const reader = await one.account('reader@test.nl', [{ scope: 'all', level: 'read' }])
    expect((await one.call(reader.bearer, '/api/export')).status).toBe(200)
    expect((await one.importFile(reader.bearer, file)).status).toBe(403)
  })
})

describe('import on the same server', () => {
  it('round trip: everything is unchanged, also the second time', async () => {
    const before = await one.snapshot(alice.bearer)
    const file = await one.exportOf(alice.bearer)
    for (let i = 0; i < 2; i++) {
      const res = await one.importFile(alice.bearer, file)
      expect(res.status).toBe(200)
      const body = await res.json()
      expect(body.total).toEqual({ created: 0, updated: 0, unchanged: 5, skipped: 0 })
      expect(await one.snapshot(alice.bearer)).toEqual(before)
    }
  })

  it('merges by id: the newest change per field wins, new entities go to their space', async () => {
    const file = await one.exportOf(alice.bearer)
    // Alice renames the shared task after the export.
    await one.push(alice.bearer, [edit('task', sharedTask.id, { title: 'Nieuwere titel' })])
    // The file has newer notes than the server, and a new task in the shared space.
    const record = file.entities.task.find((r: { id: string }) => r.id === sharedTask.id)
    record.data.notes = 'Uit het bestand'
    record.fieldTs.notes = clock.now()
    const extra = newTask({ title: 'Extra' })
    file.entities.task.push(fileRecord(extra, aliceShared))

    const res = await one.importFile(alice.bearer, file)
    expect((await res.json()).total).toEqual({ created: 1, updated: 1, unchanged: 4, skipped: 0 })
    const { entities } = await one.snapshot(alice.bearer)
    const merged = entities.find((e) => e.id === sharedTask.id)
    expect(merged?.data).toMatchObject({ title: 'Nieuwere titel', notes: 'Uit het bestand' })
    expect(entities.find((e) => e.id === extra.id)?.spaceId).toBe(aliceShared)
  })

  it('refuses a non-empty account with mode=reject', async () => {
    const file = await one.exportOf(alice.bearer)
    const res = await one.importFile(alice.bearer, file, 'reject')
    expect(res.status).toBe(409)
    expect((await res.json()).error).toBe('account_not_empty')
  })

  it('skips entities in spaces where the user may not edit, and counts them', async () => {
    const file = await one.exportOf(alice.bearer)
    const carol = await one.account('carol@test.nl')
    // Carol reads Alice's shared space; Alice's personal space is not hers at all.
    one.database.db
      .insert(spaceMembers)
      .values({
        spaceId: aliceShared,
        userId: carol.id,
        level: 'read',
        joinedAt: new Date().toISOString(),
      })
      .run()
    const before = await one.snapshot(alice.bearer)
    const res = await one.importFile(carol.bearer, file)
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.total).toEqual({ created: 0, updated: 0, unchanged: 0, skipped: 6 })
    expect(body.counts.task).toMatchObject({ skipped: 3 })
    expect(await one.snapshot(alice.bearer)).toEqual(before)
    // Nothing of it landed in Carol's own space.
    const own = await one.snapshot(carol.bearer)
    expect(own.entities.filter((e) => e.spaceId !== aliceShared)).toEqual([])
  })

  it('a member with edit merges into the shared space; the rest is skipped', async () => {
    const file = await one.exportOf(alice.bearer)
    const dave = await one.account('dave@test.nl')
    one.database.db
      .insert(spaceMembers)
      .values({
        spaceId: aliceShared,
        userId: dave.id,
        level: 'edit',
        joinedAt: new Date().toISOString(),
      })
      .run()
    const body = await (await one.importFile(dave.bearer, file)).json()
    // Shared: project, tag and two tasks. Personal: a task and a tag.
    expect(body.total).toEqual({ created: 0, updated: 0, unchanged: 4, skipped: 2 })
  })

  it('places an old file by its containers, also in a shared space', async () => {
    const { entities: before } = await one.snapshot(bob.bearer)
    const old = {
      format: 'dingen-export',
      version: 1,
      entities: {
        // A task under Alice's project (Bob cannot see it), and a loose one.
        task: [
          fileRecord(newTask({ title: 'Onder Alice', projectId: project.id })),
          fileRecord(newTask({ title: 'Los' })),
        ],
      },
    }
    const res = await one.importFile(bob.bearer, old)
    expect((await res.json()).total).toMatchObject({ created: 2, skipped: 0 })
    const after = await one.snapshot(bob.bearer)
    const personal = after.spaces.find((s) => s.kind === 'personal')?.id
    const added = after.entities.filter((e) => !before.some((b) => b.id === e.id))
    expect(added.map((e) => e.spaceId)).toEqual([personal, personal])

    // A task under Alice's shared project, imported by Alice from an old file.
    const child = newTask({ title: 'In het project', projectId: project.id })
    const res2 = await one.importFile(alice.bearer, {
      format: 'dingen-export',
      version: 1,
      entities: { task: [fileRecord(child)] },
    })
    expect((await res2.json()).total).toMatchObject({ created: 1 })
    const placed = (await one.snapshot(alice.bearer)).entities.find((e) => e.id === child.id)
    expect(placed?.spaceId).toBe(aliceShared)
  })

  it('falls back to the personal space when the container is read only', async () => {
    const erin = await one.account('erin@test.nl')
    one.database.db
      .insert(spaceMembers)
      .values({
        spaceId: aliceShared,
        userId: erin.id,
        level: 'read',
        joinedAt: new Date().toISOString(),
      })
      .run()
    const child = newTask({ title: 'Van Erin', projectId: project.id })
    const res = await one.importFile(erin.bearer, {
      format: 'dingen-export',
      version: 2,
      spaces: [{ id: aliceShared, kind: 'shared' }],
      entities: { task: [fileRecord(child, aliceShared)] },
    })
    expect((await res.json()).total).toMatchObject({ created: 1, skipped: 0 })
    const after = await one.snapshot(erin.bearer)
    const personal = after.spaces.find((s) => s.kind === 'personal')?.id
    expect(after.entities.find((e) => e.id === child.id)?.spaceId).toBe(personal)
  })
})

describe('import on another server', () => {
  it('maps the personal space and makes the shared space once', async () => {
    const file = await one.exportOf(alice.bearer)
    const two = server()
    const frank = await two.account('frank@test.nl')

    const res = await two.importFile(frank.bearer, file, 'reject')
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.total).toEqual({ created: 7, updated: 0, unchanged: 0, skipped: 0 })

    const after = await two.snapshot(frank.bearer)
    const personal = after.spaces.find((s) => s.kind === 'personal')?.id
    expect(after.spaces).toEqual([
      { id: personal, kind: 'personal', level: 'manage' },
      { id: aliceShared, kind: 'shared', level: 'manage' },
    ])
    // Frank owns the new space and is its only member.
    const space = two.database.db.select().from(spaces).where(eq(spaces.id, aliceShared)).get()
    expect(space?.ownerId).toBe(frank.id)
    expect(
      two.database.db
        .select()
        .from(spaceMembers)
        .where(eq(spaceMembers.spaceId, aliceShared))
        .all()
        .map((m) => [m.userId, m.level]),
    ).toEqual([[frank.id, 'manage']])

    // Each entity in its space, with the data and stamps of the file.
    const fromFile = Object.entries(file.entities).flatMap(([type, list]) =>
      (list as { id: string; spaceId: string; data: unknown; fieldTs: unknown }[]).map((r) => ({
        entityType: type,
        id: r.id,
        spaceId: r.spaceId === aliceShared ? aliceShared : personal,
        data: r.data,
        fieldTs: r.fieldTs,
      })),
    )
    expect(after.entities).toEqual(fromFile.sort((a, b) => (a.id < b.id ? -1 : 1)))

    // Clients get it through sync, in both protocols.
    const p1 = await (await two.call(frank.bearer, '/api/sync/pull?since=0')).json()
    expect(p1.changes.length).toBeGreaterThan(0)
    const p2 = await (
      await two.call(frank.bearer, `/api/sync/pull?cursor=${encodeURIComponent('{}')}`)
    ).json()
    expect(p2.spaces.map((s: { id: string }) => s.id).sort()).toEqual(
      [personal, aliceShared].sort(),
    )

    // Idempotent: the second import finds the space and changes nothing.
    const again = await (await two.importFile(frank.bearer, file)).json()
    expect(again.total).toEqual({ created: 0, updated: 0, unchanged: 7, skipped: 0 })
    expect(await two.snapshot(frank.bearer)).toEqual(after)
    expect(two.database.db.select().from(spaces).all()).toHaveLength(2)
  })

  it('imports an old file into the personal space', async () => {
    const two = server()
    const gina = await two.account('gina@test.nl')
    const p = newProject({ title: 'Oud project' })
    const child = newTask({ title: 'Oude taak', projectId: p.id })
    const old = {
      format: 'dingen-export',
      version: 1,
      entities: { project: [fileRecord(p)], task: [fileRecord(child)] },
    }
    const res = await two.importFile(gina.bearer, old)
    expect((await res.json()).total).toEqual({ created: 2, updated: 0, unchanged: 0, skipped: 0 })
    const after = await two.snapshot(gina.bearer)
    expect(after.spaces).toHaveLength(1)
    expect(after.entities.map((e) => e.spaceId)).toEqual([after.spaces[0]?.id, after.spaces[0]?.id])
    const again = await (await two.importFile(gina.bearer, old)).json()
    expect(again.total).toEqual({ created: 0, updated: 0, unchanged: 2, skipped: 0 })
  })

  it('merges tags per space by their lowercase name', async () => {
    const two = server()
    const hank = await two.account('hank@test.nl')
    // Hank already has "werk" in his personal space.
    const own = { ...newTag('werk'), createdAt: '2026-01-01T00:00:00.000Z' }
    await two.push(hank.bearer, [create('tag', own)])

    const personal = ulid()
    const shared = ulid()
    const personalTag = { ...newTag('Werk'), createdAt: '2026-02-01T00:00:00.000Z' }
    const loud = { ...newTag('WERK'), createdAt: '2026-03-01T00:00:00.000Z' }
    const sharedTag2 = { ...newTag('Werk'), createdAt: '2026-02-01T00:00:00.000Z' }
    const mineTask = newTask({ title: 'Eigen', tagIds: [personalTag.id] })
    const togetherTask = newTask({ title: 'Samen', tagIds: [sharedTag2.id, loud.id] })
    const file = {
      format: 'dingen-export',
      version: 2,
      spaces: [
        { id: personal, kind: 'personal' },
        { id: shared, kind: 'shared' },
      ],
      entities: {
        tag: [
          fileRecord(personalTag, personal),
          fileRecord(sharedTag2, shared),
          fileRecord(loud, shared),
        ],
        task: [fileRecord(mineTask, personal), fileRecord(togetherTask, shared)],
      },
    }
    expect((await two.importFile(hank.bearer, file)).status).toBe(200)

    const { entities } = await two.snapshot(hank.bearer)
    const liveTags = entities
      .filter((e) => e.entityType === 'tag' && !e.data.deleted)
      .map((e) => [e.spaceId, e.id, e.data.title])
    const home = (await two.snapshot(hank.bearer)).spaces.find((s) => s.kind === 'personal')?.id
    // One "werk" per space: Hank's own at home, the oldest imported one in the shared space.
    expect(liveTags.sort()).toEqual(
      [
        [home, own.id, 'werk'],
        [shared, sharedTag2.id, 'werk'],
      ].sort(),
    )
    expect(entities.find((e) => e.id === mineTask.id)?.data.tagIds).toEqual([own.id])
    expect(entities.find((e) => e.id === togetherTask.id)?.data.tagIds).toEqual([sharedTag2.id])

    // Again: nothing changes.
    const before = await two.snapshot(hank.bearer)
    const again = await (await two.importFile(hank.bearer, file)).json()
    expect(again.total.created + again.total.updated).toBe(0)
    expect(await two.snapshot(hank.bearer)).toEqual(before)
  })
})

describe('invalid files', () => {
  it('are refused without writing anything', async () => {
    const two = server()
    const ivy = await two.account('ivy@test.nl')
    const good = await one.exportOf(alice.bearer)
    const task0 = good.entities.task[0]
    const withTask = (task: unknown) => ({ ...good, entities: { ...good.entities, task: [task] } })
    const cases: [string, unknown][] = [
      ['not a JSON object', 'tekst'],
      ['wrong format', { ...good, format: 'iets-anders' }],
      ['unknown version', { ...good, version: 3 }],
      ['version 2 without spaces', { ...good, spaces: undefined }],
      ['invalid task', withTask({ ...task0, data: { ...task0.data, status: 'kapot' } })],
      ['id differs', withTask({ ...task0, id: ulid() })],
      ['stamp missing', withTask({ ...task0, fieldTs: {} })],
      ['unknown space', withTask({ ...task0, spaceId: ulid() })],
      [
        'two personal spaces',
        { ...good, spaces: [...good.spaces, { id: ulid(), kind: 'personal' }] },
      ],
    ]
    for (const [name, body] of cases) {
      const res = await two.importFile(ivy.bearer, body)
      expect(res.status, name).toBe(400)
      const json = await res.json()
      expect(json.error, name).toBe('invalid_export')
      expect(json.issues.length, name).toBeGreaterThan(0)
    }
    expect((await two.snapshot(ivy.bearer)).entities).toEqual([])
    expect(two.database.db.select().from(spaces).all()).toHaveLength(1)
  })

  it('an unknown mode is refused', async () => {
    const res = await one.importFile(alice.bearer, {}, 'wissen')
    expect(res.status).toBe(400)
  })
})
