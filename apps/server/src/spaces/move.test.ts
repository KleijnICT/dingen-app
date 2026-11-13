import {
  type AgentGrant,
  type Change,
  createClock,
  type EntityRecord,
  type EntityType,
  newArea,
  newChecklistItem,
  newHeading,
  newProject,
  newTag,
  newTask,
  type PullResponse,
  type SpaceCursor,
  ulid,
} from '@dingen/core'
import { and, eq } from 'drizzle-orm'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { ActivityService } from '../activity/service.js'
import { AgentScopeError } from '../agents/access.js'
import { createApp } from '../app.js'
import { type OpenedDatabase, openDatabase } from '../db.js'
import { changes, entities, spaceMembers, spaces } from '../schema.js'
import { SyncService, SyncValidationError } from '../sync.js'
import { childrenOf } from './move.js'
import { createPersonalSpace, SpaceAccessError } from './service.js'

/** Moving between spaces (plan 23, part 3). */

const clock = createClock('MOVETEST')
const opened: OpenedDatabase[] = []

afterEach(() => {
  for (const d of opened.splice(0)) d.close()
})

function change(entityType: EntityType, entityId: string, fields: Record<string, unknown>): Change {
  return { id: ulid(), entityType, entityId, fields, ts: clock.now(), clientId: 'T' }
}

function created(entityType: EntityType, entity: { id: string }, spaceId?: string): Change {
  const { id, ...fields } = entity
  return change(entityType, id, spaceId ? { ...fields, spaceId } : fields)
}

/** Three users: A and B in both shared spaces S1 and S2, C only in S1. */
function world() {
  const database = openDatabase(':memory:')
  opened.push(database)
  const sync = new SyncService(database.db)
  const at = '2026-01-01T00:00:00.000Z'
  const personal: Record<string, string> = {}
  for (const id of ['A', 'B', 'C']) {
    database.sqlite
      .prepare("insert into users (id, email, password_hash, created_at) values (?, ?, 'x', ?)")
      .run(id, `${id.toLowerCase()}@example.com`, at)
    personal[id] = createPersonalSpace(database.db, id, at)
  }
  const shared = (members: Record<string, 'read' | 'edit' | 'manage'>) => {
    const id = ulid()
    database.db.insert(spaces).values({ id, kind: 'shared', ownerId: 'A', createdAt: at }).run()
    for (const [userId, level] of Object.entries(members)) {
      database.db.insert(spaceMembers).values({ spaceId: id, userId, level, joinedAt: at }).run()
    }
    return id
  }
  const s1 = shared({ A: 'manage', B: 'edit', C: 'edit' })
  const s2 = shared({ A: 'manage', B: 'edit' })
  const stored = (type: EntityType, id: string) =>
    database.db
      .select()
      .from(entities)
      .where(and(eq(entities.entityType, type), eq(entities.id, id)))
      .get()
  const cursorOf = (userId: string): SpaceCursor => sync.pullSpaces(userId, {}).cursor
  return { database, sync, personal, s1, s2, shared, stored, cursorOf }
}

const spaceOf = (body: PullResponse, id: string) => body.spaces.find((s) => s.id === id)
const keys = (list: { entityType: string; id: string }[] | undefined) =>
  (list ?? []).map((r) => `${r.entityType}:${r.id}`).sort()
const key = (type: string, id: string) => `${type}:${id}`

describe('moving between spaces', () => {
  let w: ReturnType<typeof world>
  beforeEach(() => {
    w = world()
  })

  it('moves a task with its checklist; a member of both sees it move, one of the old space sees it go', () => {
    const { sync, s1, s2 } = w
    const project = newProject({ title: 'Stays', order: 'a' })
    const task = newTask({ title: 'Goes', order: 'a', projectId: project.id })
    const item = newChecklistItem({ taskId: task.id, title: 'Step', order: 'a' })
    sync.push('A', [
      created('project', project, s1),
      created('task', task),
      created('checklistItem', item),
    ])
    // New entities without spaceId follow their container.
    expect(w.stored('task', task.id)?.spaceId).toBe(s1)
    expect(w.stored('checklistItem', item.id)?.spaceId).toBe(s1)
    const before = { A: w.cursorOf('A'), B: w.cursorOf('B'), C: w.cursorOf('C') }

    const move = change('task', task.id, { spaceId: s2, notes: 'on the way' })
    const answer = sync.push('A', [move], { cursor: before.A })
    expect(answer.applied).toBe(1)
    expect(keys(answer.placed)).toEqual(
      [key('task', task.id), key('checklistItem', item.id)].sort(),
    )
    expect(answer.placed?.every((p) => p.spaceId === s2)).toBe(true)
    // The server wrote more than the push: the client has to pull both spaces.
    expect(answer.cursor).toEqual({})

    // Same id, new space; the project stayed behind, so the task is loose there now.
    const row = w.stored('task', task.id)
    expect(row?.spaceId).toBe(s2)
    expect(row?.data).toMatchObject({ projectId: null, headingId: null, notes: 'on the way' })
    expect(w.stored('checklistItem', item.id)?.spaceId).toBe(s2)
    expect(w.stored('project', project.id)?.spaceId).toBe(s1)

    // B (both spaces): the whole task and item arrive in S2; nothing leaves S1.
    const forB = sync.pullSpaces('B', before.B)
    expect(spaceOf(forB, s1)?.left).toBeUndefined()
    expect(spaceOf(forB, s1)?.changes).toEqual([])
    const arrived = spaceOf(forB, s2)?.arrived ?? []
    expect(keys(arrived)).toEqual([key('task', task.id), key('checklistItem', item.id)].sort())
    expect(arrived.find((r) => r.id === task.id)?.data).toMatchObject({
      title: 'Goes',
      notes: 'on the way',
      projectId: null,
    })
    // The fix the server made comes as a plain change too.
    expect(spaceOf(forB, s2)?.changes.map((c) => c.fields)).toEqual([{ projectId: null }])

    // C (only S1): the task and its item left, as a deletion.
    const forC = sync.pullSpaces('C', before.C)
    expect(keys(spaceOf(forC, s1)?.left)).toEqual(
      [key('task', task.id), key('checklistItem', item.id)].sort(),
    )
    expect(spaceOf(forC, s1)?.arrived).toBeUndefined()
    expect(sync.snapshot('C').entities.map((e) => e.id)).toEqual([project.id])
    expect(sync.snapshot('B').entities.find((e) => e.id === task.id)?.spaceId).toBe(s2)
  })

  it('speaks protocol 1 too: gone is a deletion, arriving the whole record, and back again', () => {
    const { sync, s1, s2 } = w
    const task = newTask({ title: 'Traveller', order: 'a' })
    sync.push('A', [created('task', task, s1)])
    const seqC = sync.pull('C', 0).seq
    const seqB = sync.pull('B', 0).seq

    sync.push('A', [change('task', task.id, { spaceId: s2 })])
    const forC = sync.pull('C', seqC)
    expect(forC.changes.map((c) => [c.entityId, c.fields])).toEqual([[task.id, { deleted: true }]])
    // B sees the record arrive again (as plain changes); applying them changes nothing.
    const forB = sync.pull('B', seqB)
    expect(forB.changes.every((c) => c.entityId === task.id)).toBe(true)
    expect(Object.assign({}, ...forB.changes.map((c) => c.fields))).toMatchObject({
      title: 'Traveller',
      deleted: false,
    })

    // Back in S1: C gets it again, with `deleted: false` newer than its deletion.
    sync.push('A', [change('task', task.id, { spaceId: s1 })])
    const again = sync.pull('C', forC.seq)
    const merged = again.changes.reduce<EntityRecord | undefined>(
      (rec, c) => ({
        entityType: 'task',
        id: task.id,
        data: { ...rec?.data, ...c.fields },
        fieldTs: {
          ...rec?.fieldTs,
          ...Object.fromEntries(Object.keys(c.fields).map((f) => [f, c.ts])),
        },
      }),
      undefined,
    )
    expect(merged?.data).toMatchObject({ title: 'Traveller', deleted: false })
    const deletedTs = forC.changes[0]?.ts ?? ''
    expect((merged?.fieldTs.deleted ?? '') >= deletedTs).toBe(true)
  })

  it('moves a project with its headings, tasks and checklist items', () => {
    const { sync, personal, s2 } = w
    const area = newArea({ title: 'Home', order: 'a' })
    const project = newProject({ title: 'Kitchen', order: 'a', areaId: area.id })
    const heading = newHeading({ projectId: project.id, title: 'Phase 1', order: 'a' })
    const t1 = newTask({ title: 'Plan', order: 'a', projectId: project.id, headingId: heading.id })
    const t2 = newTask({ title: 'Buy', order: 'b', projectId: project.id })
    const item = newChecklistItem({ taskId: t1.id, title: 'Measure', order: 'a' })
    const loose = newTask({ title: 'Elsewhere', order: 'c', areaId: area.id })
    sync.push('A', [
      created('area', area),
      created('project', project),
      created('heading', heading),
      created('task', t1),
      created('task', t2),
      created('checklistItem', item),
      created('task', loose),
    ])
    expect(w.stored('task', t1.id)?.spaceId).toBe(personal.A)
    const cursorB = w.cursorOf('B')

    const answer = sync.push('A', [change('project', project.id, { spaceId: s2 })])
    expect(keys(answer.placed)).toEqual(
      [
        key('project', project.id),
        key('heading', heading.id),
        key('task', t1.id),
        key('task', t2.id),
        key('checklistItem', item.id),
      ].sort(),
    )
    for (const [type, id] of [
      ['project', project.id],
      ['heading', heading.id],
      ['task', t1.id],
      ['task', t2.id],
      ['checklistItem', item.id],
    ] as const) {
      expect(w.stored(type, id)?.spaceId, `${type} ${id}`).toBe(s2)
    }
    // Inside the project nothing changes; the area stayed behind.
    expect(w.stored('task', t1.id)?.data).toMatchObject({
      projectId: project.id,
      headingId: heading.id,
    })
    expect(w.stored('project', project.id)?.data.areaId).toBeNull()
    expect(w.stored('area', area.id)?.spaceId).toBe(personal.A)
    expect(w.stored('task', loose.id)?.spaceId).toBe(personal.A)

    // B was never in A's personal space: the whole project arrives in S2.
    const forB = sync.pullSpaces('B', cursorB)
    expect(keys(spaceOf(forB, s2)?.arrived)).toEqual(keys(answer.placed))
    expect(sync.snapshot('B', null, s2).entities).toHaveLength(5)
  })

  it('moves an area with its projects and loose tasks, and their children', () => {
    const { sync, s1, s2 } = w
    const area = newArea({ title: 'Club', order: 'a' })
    const other = newArea({ title: 'Other', order: 'b' })
    const project = newProject({ title: 'Season', order: 'a', areaId: area.id })
    const inProject = newTask({ title: 'Schedule', order: 'a', projectId: project.id })
    const loose = newTask({ title: 'Pay fee', order: 'b', areaId: area.id })
    const item = newChecklistItem({ taskId: loose.id, title: 'Bank', order: 'a' })
    const notMine = newTask({ title: 'Other area', order: 'c', areaId: other.id })
    sync.push('A', [
      created('area', area, s1),
      created('area', other, s1),
      created('project', project),
      created('task', inProject),
      created('task', loose),
      created('checklistItem', item),
      created('task', notMine),
    ])
    const cursorC = w.cursorOf('C')

    sync.push('A', [change('area', area.id, { spaceId: s2 })])
    for (const [type, id] of [
      ['area', area.id],
      ['project', project.id],
      ['task', inProject.id],
      ['task', loose.id],
      ['checklistItem', item.id],
    ] as const) {
      expect(w.stored(type, id)?.spaceId, type).toBe(s2)
    }
    expect(w.stored('task', loose.id)?.data.areaId).toBe(area.id)
    expect(w.stored('project', project.id)?.data.areaId).toBe(area.id)
    expect(w.stored('task', notMine.id)?.spaceId).toBe(s1)
    expect(w.stored('area', other.id)?.spaceId).toBe(s1)

    const forC = sync.pullSpaces('C', cursorC)
    expect(keys(spaceOf(forC, s1)?.left)).toHaveLength(5)
    expect(
      sync
        .snapshot('C')
        .entities.map((e) => e.id)
        .sort(),
    ).toEqual([other.id, notMine.id].sort())
  })

  it('refuses a move without edit in both spaces, or of what cannot move on its own', () => {
    const { sync, personal, s1, s2, shared } = w
    const readOnly = shared({ A: 'manage', B: 'read' })
    const task = newTask({ title: 'Mine', order: 'a' })
    const heading = newHeading({ projectId: ulid(), title: 'H', order: 'a' })
    sync.push('B', [created('task', task), created('heading', heading)])

    const refused = (target: string) => () =>
      sync.push('B', [change('task', task.id, { spaceId: target })])
    expect(refused(readOnly)).toThrow(SpaceAccessError)
    expect(refused(personal.A)).toThrow(SpaceAccessError)
    expect(refused('no-such-space')).toThrow(SpaceAccessError)
    expect(w.stored('task', task.id)?.spaceId).toBe(personal.B)

    // From a space where B can only read.
    const there = newTask({ title: 'Read only', order: 'a' })
    sync.push('A', [created('task', there, readOnly)])
    expect(() => sync.push('B', [change('task', there.id, { spaceId: s1 })])).toThrow(
      SpaceAccessError,
    )

    // A heading or a checklist item moves with its project or task, not alone.
    expect(() => sync.push('B', [change('heading', heading.id, { spaceId: s2 })])).toThrow(
      SyncValidationError,
    )
    expect(() => sync.push('B', [change('task', task.id, { spaceId: 5 })])).toThrow(
      SyncValidationError,
    )
    // A new task in a space B can only read.
    expect(() =>
      sync.push('B', [created('task', newTask({ title: 'x', order: 'a' }), readOnly)]),
    ).toThrow(SpaceAccessError)
  })

  it('makes tags the target space tags with the same name, created once when missing', () => {
    const { sync, s1, s2 } = w
    const home = newTag({ title: 'Home', order: 'a' })
    const urgent = newTag({ title: 'urgent', order: 'b' })
    const gone = newTag({ title: 'Gone', order: 'c' })
    const there = newTag({ title: 'HOME', order: 'a' })
    const t1 = newTask({ title: 'One', order: 'a', tagIds: [home.id, urgent.id, gone.id] })
    const t2 = newTask({ title: 'Two', order: 'b', tagIds: [urgent.id] })
    const project = newProject({ title: 'P', order: 'a', tagIds: [urgent.id] })
    sync.push('A', [
      created('tag', home),
      created('tag', urgent),
      created('tag', gone),
      created('tag', there, s1),
      created('task', t1),
      created('task', t2),
      created('project', project),
    ])
    sync.push('A', [change('tag', gone.id, { deleted: true })])

    const answer = sync.push('A', [
      change('task', t1.id, { spaceId: s1 }),
      change('task', t2.id, { spaceId: s1 }),
      change('project', project.id, { spaceId: s1 }),
    ])
    const made = answer.placed?.filter((p) => p.entityType === 'tag') ?? []
    expect(made).toHaveLength(1)
    const urgentThere = made[0]?.id ?? ''
    expect(w.stored('tag', urgentThere)).toMatchObject({ spaceId: s1 })
    expect(w.stored('tag', urgentThere)?.data).toMatchObject({ title: 'urgent', deleted: false })
    // "Home" matched "HOME" whatever the case; the deleted tag fell off.
    expect(w.stored('task', t1.id)?.data.tagIds).toEqual([there.id, urgentThere])
    expect(w.stored('task', t2.id)?.data.tagIds).toEqual([urgentThere])
    expect(w.stored('project', project.id)?.data.tagIds).toEqual([urgentThere])
    // The personal tags stay where they were.
    expect(w.stored('tag', urgent.id)?.spaceId).toBe(w.personal.A)

    // Back to the personal space: the shared tags become the personal ones again.
    sync.push('A', [change('task', t2.id, { spaceId: w.personal.A })])
    expect(w.stored('task', t2.id)?.data.tagIds).toEqual([urgent.id])
    // C sees the shared tag (a plain new entity), not A's personal ones.
    const tagsForC = sync.snapshot('C').entities.filter((e) => e.entityType === 'tag')
    expect(tagsForC.map((t) => t.data.title).sort()).toEqual(['home', 'urgent'])
    void s2
  })

  it('lets an agent move only with edit on everything; a narrow agent sees moves as coming and going', () => {
    const { sync, s1, s2 } = w
    const area = newArea({ title: 'Work', order: 'a' })
    const project = newProject({ title: 'Launch', order: 'a', areaId: area.id })
    const task = newTask({ title: 'Ship', order: 'a', projectId: project.id })
    const other = newTask({ title: 'Also', order: 'b', projectId: project.id })
    sync.push('A', [
      created('area', area, s1),
      created('project', project),
      created('task', task),
      created('task', other),
    ])
    const narrow: AgentGrant[] = [{ scope: 'project', id: project.id, level: 'edit' }]
    const agent = (grants: AgentGrant[]) => ({
      access: { userId: 'A', actor: 'agent:X' as const, grants },
    })
    expect(() => sync.push('A', [change('task', task.id, { spaceId: s2 })], agent(narrow))).toThrow(
      AgentScopeError,
    )
    const all: AgentGrant[] = [{ scope: 'all', level: 'edit' }]
    const cursor = sync.pullSpaces('A', {}, undefined, narrow).cursor

    // The task leaves the project for S2: out of the narrow agent's reach.
    sync.push('A', [change('task', task.id, { spaceId: s2 })], agent(all))
    const first = sync.pullSpaces('A', cursor, undefined, narrow)
    expect(keys(spaceOf(first, s1)?.left)).toEqual([key('task', task.id)])
    expect(spaceOf(first, s2)?.arrived).toBeUndefined()

    // The whole area moves: the project and its other task stay in reach, and arrive in S2.
    sync.push('A', [change('area', area.id, { spaceId: s2 })])
    const second = sync.pullSpaces('A', first.cursor, undefined, narrow)
    // The area itself was never in reach; its leave is a no-op for the agent.
    expect(keys(spaceOf(second, s1)?.left)).toEqual([key('area', area.id)])
    expect(keys(spaceOf(second, s2)?.arrived)).toEqual(
      [key('project', project.id), key('task', other.id)].sort(),
    )
    // Protocol 1 for the narrow agent: the task went as a deletion.
    const p1 = sync.pull('A', 0, undefined, narrow)
    expect(p1.changes.some((c) => c.entityId === task.id && c.fields.deleted === true)).toBe(true)
  })

  it('places new entities: asked for, from the container, else personal; no container elsewhere', () => {
    const { sync, personal, s1, s2 } = w
    const project = newProject({ title: 'Shared', order: 'a' })
    const inProject = newTask({ title: 'In it', order: 'a', projectId: project.id })
    const plain = newTask({ title: 'Plain', order: 'b' })
    const answer = sync.push('B', [
      created('project', project, s1),
      created('task', inProject),
      created('task', plain),
    ])
    expect(answer.placed).toEqual([
      { entityType: 'project', id: project.id, spaceId: s1 },
      { entityType: 'task', id: inProject.id, spaceId: s1 },
      { entityType: 'task', id: plain.id, spaceId: personal.B },
    ])
    expect(w.stored('task', plain.id)?.data.spaceId).toBeUndefined()
    // A container in another space than the one asked for is refused.
    expect(() =>
      sync.push('B', [
        created('task', newTask({ title: 'x', order: 'c', projectId: project.id }), s2),
      ]),
    ).toThrow(SyncValidationError)
    // No spaceId in the stored change of a new entity: it is not a move.
    const rows = w.database.db.select().from(changes).where(eq(changes.entityId, plain.id)).all()
    expect(rows.map((r) => 'spaceId' in r.fields)).toEqual([false])
  })

  it('shows one Logbook line for a move, and nothing of it to someone who lost sight', () => {
    const { sync, database, s1, s2 } = w
    const activity = new ActivityService(database.db)
    const project = newProject({ title: 'Garden', order: 'a' })
    const task = newTask({ title: 'Dig', order: 'a', projectId: project.id })
    sync.push('A', [created('project', project, s1), created('task', task)])
    sync.push('A', [change('project', project.id, { spaceId: s2 })])

    const forA = activity.list('A').items
    expect(forA[0]).toMatchObject({
      kind: 'moved',
      entityId: project.id,
      title: 'Garden',
      fields: [{ field: 'space', from: null, to: 'shared' }],
    })
    // The task moved along without a line of its own.
    expect(forA.filter((i) => i.kind === 'moved')).toHaveLength(1)
    expect(activity.list('A', { kinds: ['moved'] }).items).toHaveLength(1)
    // C only had S1: the project and its task are gone from C's Logbook.
    expect(activity.list('C').items).toEqual([])
    // Moved back to A's personal space: "moved to the personal space".
    sync.push('A', [change('project', project.id, { spaceId: w.personal.A })])
    expect(activity.list('A').items[0]).toMatchObject({
      kind: 'moved',
      fields: [{ field: 'space', from: null, to: 'personal' }],
    })
  })

  it('answers 403 space_access over HTTP and takes spaceId on a push', async () => {
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
    const push = (body: unknown) =>
      app.request('/api/sync/push', {
        method: 'POST',
        headers: { 'content-type': 'application/json', cookie },
        body: JSON.stringify(body),
      })
    const task = newTask({ title: 'Here', order: 'a' })
    expect((await push({ changes: [created('task', task)] })).status).toBe(200)
    const refused = await push({ changes: [change('task', task.id, { spaceId: 'elsewhere' })] })
    expect(refused.status).toBe(403)
    expect(await refused.json()).toMatchObject({ error: 'space_access' })
  })
})

describe('children of a moved entity', () => {
  it('follows containers, repeat instances and checklist items, parents first', () => {
    const rec = (entityType: EntityType, id: string, data: Record<string, unknown> = {}) => ({
      entityType,
      id,
      data: { id, ...data },
      fieldTs: {},
    })
    const template = rec('task', 'T', { projectId: 'P' })
    const live = [
      rec('project', 'P', { areaId: null }),
      template,
      rec('task', 'I', { projectId: null, templateId: 'T' }),
      rec('checklistItem', 'C', { taskId: 'I' }),
      rec('task', 'X', { projectId: 'Q' }),
    ]
    expect(childrenOf(template, live).map((r) => r.id)).toEqual(['I', 'C'])
    expect(childrenOf(live[0] as EntityRecord, live).map((r) => r.id)).toEqual(['T', 'I', 'C'])
  })
})
