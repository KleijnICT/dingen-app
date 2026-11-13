import {
  type Change,
  createClock,
  newProject,
  newTask,
  type SpaceCursor,
  type Tag,
  ulid,
} from '@dingen/core'
import { and, eq } from 'drizzle-orm'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { ActivityService } from '../activity/service.js'
import { type OpenedDatabase, openDatabase } from '../db.js'
import { entities, meta } from '../schema.js'
import { createPersonalSpace } from '../spaces/service.js'
import { normalizePushedTag, SyncService } from '../sync.js'
import {
  LOWERCASE_TAGS_KEY,
  lowercaseTags,
  migrateLowercaseTags,
  planTagCleanup,
} from './lowercase.js'

const clock = createClock('TAGTEST')

function create(entityType: 'task' | 'tag' | 'project', entity: { id: string }): Change {
  const { id, ...fields } = entity
  return { id: ulid(), entityType, entityId: id, fields, ts: clock.now(), clientId: 'T' }
}

/** A tag as old data has it: any title, written straight (newTag lowercases). */
function oldTag(title: string, createdAt: string, parentId: string | null = null): Tag {
  return { id: ulid(), title, parentId, createdAt, deleted: false, order: 'm' }
}

const row = (id: string, title: string, createdAt: string, parentId: string | null = null) => ({
  id,
  title,
  parentId,
  createdAt,
})

describe('planTagCleanup', () => {
  it('lowercases titles without merging distinct tags', () => {
    const plan = planTagCleanup([row('A', 'Werk', '1'), row('B', 'thuis', '2')])
    expect(plan.merged.size).toBe(0)
    expect([...plan.updates]).toEqual([['A', { title: 'werk' }]])
  })

  it('keeps the oldest of tags that become equal', () => {
    const plan = planTagCleanup([row('B', 'werk', '2'), row('A', 'Werk ', '1')])
    expect([...plan.merged]).toEqual([['B', 'A']])
    expect(plan.updates.get('A')).toEqual({ title: 'werk' })
  })

  it('merges children once their parents merge, and re-parents the rest', () => {
    const plan = planTagCleanup([
      row('P1', 'Personen', '1'),
      row('P2', 'personen', '2'),
      row('C1', 'Anne', '3', 'P1'),
      row('C2', 'anne', '4', 'P2'),
      row('C3', 'Bob', '5', 'P2'),
    ])
    expect(plan.merged).toEqual(
      new Map([
        ['P2', 'P1'],
        ['C2', 'C1'],
      ]),
    )
    expect(plan.updates.get('C3')).toEqual({ title: 'bob', parentId: 'P1' })
  })

  it('does not merge equal names under different parents', () => {
    const plan = planTagCleanup([
      row('P1', 'a', '1'),
      row('P2', 'b', '2'),
      row('C1', 'X', '3', 'P1'),
      row('C2', 'x', '4', 'P2'),
    ])
    expect(plan.merged.size).toBe(0)
  })

  it('leaves emoji and blank titles alone', () => {
    const plan = planTagCleanup([row('A', '🔥', '1'), row('B', '   ', '2'), row('C', '  ', '3')])
    expect(plan.merged.size).toBe(0)
    expect(plan.updates.size).toBe(0)
  })
})

describe('lowercaseTags on the database', () => {
  let database: OpenedDatabase
  let sync: SyncService
  let personal: string

  function addUser(id: string): string {
    database.sqlite
      .prepare("insert into users (id, email, password_hash, created_at) values (?, ?, 'x', ?)")
      .run(id, `${id.toLowerCase()}@example.com`, '2026-01-01T00:00:00.000Z')
    return createPersonalSpace(database.db, id, '2026-01-01T00:00:00.000Z')
  }

  function data(type: string, id: string): Record<string, unknown> | undefined {
    return database.db
      .select()
      .from(entities)
      .where(and(eq(entities.entityType, type), eq(entities.id, id)))
      .get()?.data
  }

  beforeEach(() => {
    database = openDatabase(':memory:')
    sync = new SyncService(database.db)
    personal = addUser('A')
  })

  afterEach(() => database.close())

  it('lowercases, merges, re-points tasks and re-parents children', () => {
    const werk = oldTag('Werk', '2026-01-02T00:00:00.000Z')
    const werk2 = oldTag('werk', '2026-01-03T00:00:00.000Z')
    const child = oldTag('Mails', '2026-01-04T00:00:00.000Z', werk2.id)
    const deadTag = { ...oldTag('Weg', '2026-01-01T00:00:00.000Z'), deleted: true }
    const t1 = newTask({ title: 'Op werk', tagIds: [werk.id] })
    const t2 = newTask({ title: 'Op werk2', tagIds: [werk2.id, child.id] })
    const both = newTask({ title: 'Op beide', tagIds: [werk.id, werk2.id] })
    const project = newProject({ title: 'Project', tagIds: [werk2.id] })
    sync.push('A', [
      create('tag', werk),
      create('tag', werk2),
      create('tag', child),
      create('tag', deadTag),
      create('task', t1),
      create('task', t2),
      create('task', both),
      create('project', project),
    ])

    const result = lowercaseTags(database.db)
    expect(result).toEqual({ spaces: 1, renamed: 2, merged: 1, retagged: 3 })

    expect(data('tag', werk.id)).toMatchObject({ title: 'werk', deleted: false })
    expect(data('tag', werk2.id)).toMatchObject({ deleted: true })
    expect(data('tag', child.id)).toMatchObject({ title: 'mails', parentId: werk.id })
    expect(data('tag', deadTag.id)).toMatchObject({ title: 'Weg' })
    expect(data('task', t1.id)?.tagIds).toEqual([werk.id])
    expect(data('task', t2.id)?.tagIds).toEqual([werk.id, child.id])
    expect(data('task', both.id)?.tagIds).toEqual([werk.id])
    expect(data('project', project.id)?.tagIds).toEqual([werk.id])

    // A second run finds nothing to do.
    expect(lowercaseTags(database.db)).toEqual({ spaces: 0, renamed: 0, merged: 0, retagged: 0 })
  })

  it('writes the changes to the log so clients pull them, with system as actor', () => {
    const tag = oldTag('Bellen', '2026-01-02T00:00:00.000Z')
    const { seq } = sync.push('A', [create('tag', tag)])
    const cursor: SpaceCursor = { [personal]: seq }
    lowercaseTags(database.db)

    const pulled = sync.pullSpaces('A', cursor)
    const space = pulled.spaces.find((s) => s.id === personal)
    expect(space?.changes.map((c) => [c.entityId, c.fields])).toEqual([
      [tag.id, { title: 'bellen' }],
    ])
    // Protocol 1 clients see it too.
    expect(sync.pull('A', seq).changes.map((c) => c.fields)).toEqual([{ title: 'bellen' }])
    const actors = database.sqlite.prepare('select actor from changes where seq > ?').all(seq) as {
      actor: string
    }[]
    expect(actors).toEqual([{ actor: 'system' }])
  })

  it('wins over a client stamp from the future', () => {
    const ahead = createClock('AHEAD', () => Date.now() + 86_400_000)
    const tag = oldTag('Later', '2026-01-02T00:00:00.000Z')
    const { id, ...fields } = tag
    sync.push('A', [
      { id: ulid(), entityType: 'tag', entityId: id, fields, ts: ahead.now(), clientId: 'AHEAD' },
    ])
    lowercaseTags(database.db)
    expect(data('tag', tag.id)?.title).toBe('later')
  })

  it('does not merge tags of different spaces', () => {
    addUser('B')
    const a = oldTag('Werk', '2026-01-02T00:00:00.000Z')
    const b = oldTag('werk', '2026-01-03T00:00:00.000Z')
    sync.push('A', [create('tag', a)])
    sync.push('B', [create('tag', b)])
    const result = lowercaseTags(database.db)
    expect(result).toMatchObject({ spaces: 1, renamed: 1, merged: 0 })
    expect(data('tag', a.id)).toMatchObject({ title: 'werk', deleted: false })
    expect(data('tag', b.id)).toMatchObject({ title: 'werk', deleted: false })
  })

  it('shows the re-tagged task in the Logbook as done by system', () => {
    const one = oldTag('Thuis', '2026-01-02T00:00:00.000Z')
    const two = oldTag('thuis', '2026-01-03T00:00:00.000Z')
    const task = newTask({ title: 'Lamp vervangen', tagIds: [two.id] })
    sync.push('A', [create('tag', one), create('tag', two), create('task', task)])
    lowercaseTags(database.db)

    const page = new ActivityService(database.db).list('A')
    const line = page.items.find((i) => i.entityId === task.id && i.kind === 'updated')
    expect(line?.actor).toBe('system')
    expect(line?.fields.map((f) => f.field)).toEqual(['tagIds'])
    expect(new ActivityService(database.db).list('A', { actor: 'system' }).items).toHaveLength(1)
  })

  it('runs once at start and records it in meta', () => {
    const tag = oldTag('Eens', '2026-01-02T00:00:00.000Z')
    sync.push('A', [create('tag', tag)])
    const first = migrateLowercaseTags(database.db, new Date('2026-11-13T12:00:00.000Z'))
    expect(first).toMatchObject({ spaces: 1, renamed: 1 })
    const stored = database.db.select().from(meta).where(eq(meta.key, LOWERCASE_TAGS_KEY)).get()
    expect(JSON.parse(stored?.value ?? '{}')).toMatchObject({
      at: '2026-11-13T12:00:00.000Z',
      renamed: 1,
    })

    // New capitals after the migration (an old client) are not touched at start again.
    const later = oldTag('Nieuw', '2026-01-05T00:00:00.000Z')
    sync.push('A', [create('tag', later)])
    expect(migrateLowercaseTags(database.db)).toBeNull()
    expect(data('tag', later.id)?.title).toBe('Nieuw')
  })
})

describe('normalizePushedTag', () => {
  const base = { id: 'c1', clientId: 'x', entityType: 'tag', entityId: 't1', ts: 'ts' }
  it('lowercases a tag title pushed by an older client', () => {
    const out = normalizePushedTag({ ...base, fields: { title: '  Boodschappen ' } } as never)
    expect(out.fields.title).toBe('boodschappen')
  })
  it('leaves other entities and fields alone', () => {
    const task = { ...base, entityType: 'task', fields: { title: 'Bel Anna' } } as never
    expect(normalizePushedTag(task)).toBe(task)
    const order = { ...base, fields: { order: 3 } } as never
    expect(normalizePushedTag(order)).toBe(order)
  })
})
