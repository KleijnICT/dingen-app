import {
  type ActivityItem,
  type Change,
  createClock,
  type EntityType,
  newArea,
  newChecklistItem,
  newHeading,
  newProject,
  newTask,
  ulid,
} from '@dingen/core'
import { afterAll, beforeEach, describe, expect, it } from 'vitest'
import { createApp } from '../app.js'
import { openDatabase } from '../db.js'
import { SyncService } from '../sync.js'
import { changeTimeMs } from './derive.js'
import { ActivityService } from './service.js'

const database = openDatabase(':memory:')
const sync = new SyncService(database.db)
const activity = new ActivityService(database.db)
const USER = 'U1'
const BASE = Date.parse('2026-11-10T09:00:00.000Z')
let wall = BASE
// A fresh clock per test: an HLC never goes back, and tests set their own times.
let clock = createClock('TEST', () => wall)

afterAll(() => database.close())
beforeEach(() => {
  database.sqlite.exec('delete from changes; delete from entities;')
  wall = BASE
  clock = createClock('TEST', () => wall)
})

/** Moves the clock to `minutes` after 09:00. */
function at(minutes: number) {
  wall = BASE + minutes * 60_000
}

/** Writes one change as `actor` (null = the owner) and returns its seq. */
function write(
  entityType: EntityType,
  entityId: string,
  fields: Record<string, unknown>,
  actor: string | null = null,
  user = USER,
): number {
  const change: Change = {
    id: ulid(),
    entityType,
    entityId,
    fields,
    ts: clock.now(),
    clientId: 'TEST',
  }
  const { seq } = sync.push(user, [change], { receivedAt: new Date(wall).toISOString() })
  if (actor) database.sqlite.prepare('update changes set actor = ? where seq = ?').run(actor, seq)
  return seq
}

function create<T extends { id: string }>(entityType: EntityType, entity: T, actor?: string) {
  const { id, ...fields } = entity
  write(entityType, id, fields, actor ?? null)
  return entity
}

const list = (q = {}, grants = null as Parameters<ActivityService['list']>[2]) =>
  activity.list(USER, q, grants)
const brief = (items: ActivityItem[]) => items.map((i) => `${i.kind}:${i.title}`)

describe('derivation', () => {
  it('turns the first change of an entity into "added", with its container', () => {
    const area = create('area', newArea({ title: 'Work', order: 'a' }))
    const project = create('project', newProject({ title: 'Site', areaId: area.id, order: 'a' }))
    at(10)
    create('task', newTask({ title: 'Draft', projectId: project.id, order: 'a' }))
    const { items, nextBefore } = list()
    expect(brief(items)).toEqual(['added:Draft', 'added:Site', 'added:Work'])
    expect(items[0]?.container).toEqual({ type: 'project', id: project.id, title: 'Site' })
    expect(items[1]?.container).toEqual({ type: 'area', id: area.id, title: 'Work' })
    expect(items[2]?.container).toBeNull()
    expect(items[0]?.actor).toBe(`user:${USER}`)
    expect(items[0]?.at).toBe(new Date(BASE + 10 * 60_000).toISOString())
    expect(nextBefore).toBeNull()
  })

  it('folds edits within five minutes into the added line', () => {
    const task = create('task', newTask({ title: 'Draft', order: 'a' }))
    at(2)
    write('task', task.id, { title: 'Draft the plan' })
    const { items } = list()
    expect(brief(items)).toEqual(['added:Draft the plan'])
  })

  it('shows changed fields with the value before and after, folded', () => {
    const task = create('task', newTask({ title: 'Draft', order: 'a' }))
    at(30)
    write('task', task.id, { title: 'Draft v2' })
    at(32)
    write('task', task.id, { title: 'Draft v3', when: { kind: 'date', date: '2026-11-13' } })
    at(34)
    write('task', task.id, { order: 'b' })
    const { items } = list()
    expect(items).toHaveLength(2)
    expect(items[0]?.kind).toBe('updated')
    expect(items[0]?.fields).toEqual([
      { field: 'title', from: 'Draft', to: 'Draft v3' },
      { field: 'when', from: { kind: 'inbox' }, to: { kind: 'date', date: '2026-11-13' } },
    ])
  })

  it('starts a new line after a gap of more than five minutes or another actor', () => {
    const task = create('task', newTask({ title: 'A', order: 'a' }))
    at(30)
    write('task', task.id, { title: 'B' })
    at(36)
    write('task', task.id, { title: 'C' })
    at(37)
    write('task', task.id, { title: 'D' }, 'agent:BOT')
    const { items } = list()
    expect(items.slice(0, 3).map((i) => [i.actor, i.fields[0]?.from, i.fields[0]?.to])).toEqual([
      ['agent:BOT', 'C', 'D'],
      [`user:${USER}`, 'B', 'C'],
      [`user:${USER}`, 'A', 'B'],
    ])
    expect(items[3]?.kind).toBe('added')
  })

  it('knows completed, canceled, reopened and deleted', () => {
    const a = create('task', newTask({ title: 'A', order: 'a' }))
    const b = create('task', newTask({ title: 'B', order: 'b' }))
    at(20)
    write('task', a.id, { status: 'completed', completedAt: new Date(wall).toISOString() })
    at(30)
    write('task', b.id, { status: 'canceled', completedAt: new Date(wall).toISOString() })
    at(40)
    write('task', a.id, { status: 'open', completedAt: null })
    at(50)
    write('task', b.id, { deleted: true })
    const { items } = list({ kinds: ['completed', 'reopened', 'deleted'] })
    expect(brief(items)).toEqual(['deleted:B', 'reopened:A', 'completed:B', 'completed:A'])
    expect(items[2]?.fields).toEqual([{ field: 'status', from: null, to: 'canceled' }])
  })

  it('says only that notes changed, and rolls checklist items up into their task', () => {
    const task = create('task', newTask({ title: 'Pack', order: 'a' }))
    at(20)
    write('task', task.id, { notes: 'a secret' })
    at(40)
    create('checklistItem', newChecklistItem({ taskId: task.id, title: 'Passport', order: 'a' }))
    const { items } = list()
    expect(items.map((i) => [i.kind, i.entityType, i.fields])).toEqual([
      ['updated', 'task', [{ field: 'checklist', from: null, to: null }]],
      ['updated', 'task', [{ field: 'notes', from: null, to: null }]],
      ['added', 'task', []],
    ])
    expect(JSON.stringify(items)).not.toContain('secret')
  })

  it('shows reordering only when nothing else changed', () => {
    const task = create('task', newTask({ title: 'A', order: 'a' }))
    at(20)
    write('task', task.id, { order: 'b' })
    const { items } = list()
    expect(items[0]?.fields).toEqual([{ field: 'order', from: 'a', to: 'b' }])
  })

  it('drops a line whose fields ended where they started', () => {
    const task = create('task', newTask({ title: 'A', order: 'a' }))
    at(20)
    write('task', task.id, { title: 'B' })
    at(21)
    write('task', task.id, { title: 'A' })
    expect(brief(list().items)).toEqual(['added:A'])
  })

  it('leaves out hidden repeat templates', () => {
    const template = newTask({ title: 'Water plants', order: 'a' })
    create('task', {
      ...template,
      repeat: {
        unit: 'week',
        every: 1,
        basis: 'schedule',
        weekdays: [],
        start: '2026-11-10',
        until: null,
        deadlineDays: null,
      },
    })
    at(10)
    create('task', newTask({ title: 'Water plants', order: 'b', templateId: template.id }))
    expect(brief(list().items)).toEqual(['added:Water plants'])
    expect(list().items[0]?.entityId).not.toBe(template.id)
  })

  it('gives headings their project, and tasks under a heading their project', () => {
    const project = create('project', newProject({ title: 'Trip', order: 'a' }))
    const heading = create(
      'heading',
      newHeading({ projectId: project.id, title: 'Before', order: 'a' }),
    )
    at(10)
    create(
      'task',
      newTask({ title: 'Book', projectId: project.id, headingId: heading.id, order: 'a' }),
    )
    const { items } = list()
    expect(items[0]?.container?.id).toBe(project.id)
    expect(items[1]?.entityType).toBe('heading')
    expect(items[1]?.container?.title).toBe('Trip')
  })

  it('times a line by when the server received it, so days follow the order', () => {
    expect(changeTimeMs({ receivedAt: '2026-11-10T10:00:00.000Z' })).toBe(
      Date.parse('2026-11-10T10:00:00.000Z'),
    )
  })
})

describe('filters and paging', () => {
  function seed(n: number) {
    const ids: string[] = []
    for (let i = 0; i < n; i++) {
      at(i * 10)
      ids.push(
        create('task', newTask({ title: `T${i}`, order: `a${i}` }), i % 2 ? 'agent:BOT' : undefined)
          .id,
      )
    }
    return ids
  }

  it('pages on seq without losing or repeating a line', () => {
    const ids = seed(7)
    // A folded edit on the newest task, so a group spans several rows.
    at(61)
    write('task', ids[6] as string, { title: 'T6 edited' })
    const all = list({ limit: 100 }).items
    const paged: ActivityItem[] = []
    let before: number | undefined
    for (let guard = 0; guard < 10; guard++) {
      const page = list({ limit: 3, before })
      paged.push(...page.items)
      if (page.nextBefore === null) break
      before = page.nextBefore
    }
    expect(paged).toEqual(all)
    expect(all).toHaveLength(7)
  })

  it('filters on actor and period', () => {
    seed(6)
    expect(brief(list({ actor: 'agent:BOT' }).items)).toEqual(['added:T5', 'added:T3', 'added:T1'])
    const since = new Date(BASE + 20 * 60_000).toISOString()
    const until = new Date(BASE + 40 * 60_000).toISOString()
    expect(brief(list({ since, until }).items)).toEqual(['added:T4', 'added:T3', 'added:T2'])
    expect(list({ since: '2030-01-01T00:00:00Z' }).items).toEqual([])
  })

  it('returns a short page with nextBefore when the filter is narrow', () => {
    seed(3)
    const page = list({ kinds: ['deleted'] })
    expect(page.items).toEqual([])
    expect(page.nextBefore).toBeNull()
  })
})

describe('agent access', () => {
  it('shows an agent only what its grants reach, and hides containers it cannot read', () => {
    const home = create('area', newArea({ title: 'Home', order: 'a' }))
    const work = create('area', newArea({ title: 'Work', order: 'b' }))
    const site = create('project', newProject({ title: 'Site', areaId: work.id, order: 'a' }))
    create('task', newTask({ title: 'In site', projectId: site.id, order: 'a' }))
    create('task', newTask({ title: 'At home', areaId: home.id, order: 'b' }))
    create('task', newTask({ title: 'Loose', order: 'c' }))

    const projectOnly = list({}, [{ scope: 'project', id: site.id, level: 'read' }])
    expect(brief(projectOnly.items)).toEqual(['added:In site', 'added:Site'])
    // The project is readable, its area is not.
    expect(projectOnly.items[1]?.container).toBeNull()
    expect(projectOnly.items[0]?.container?.title).toBe('Site')

    expect(brief(list({}, [{ scope: 'inbox', level: 'edit' }]).items)).toEqual(['added:Loose'])
    expect(brief(list({}, [{ scope: 'area', id: work.id, level: 'read' }]).items)).toEqual([
      'added:In site',
      'added:Site',
      'added:Work',
    ])
    expect(list({}, [{ scope: 'all', level: 'read' }]).items).toHaveLength(6)
    expect(list({}, []).items).toEqual([])
  })
})

describe('GET /api/activity', () => {
  const app = createApp({ db: database.db, version: 'test', sqliteVersion: database.sqliteVersion })
  let cookie = ''
  let userId = ''

  async function signIn() {
    if (cookie) return
    const res = await app.request('/api/auth/register', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ email: 'activity@test.nl', password: 'wachtwoord123' }),
    })
    cookie = res.headers.get('set-cookie') ?? ''
    userId = ((await res.json()) as { user: { id: string } }).user.id
  }

  it('needs a signed-in user', async () => {
    expect((await app.request('/api/activity')).status).toBe(401)
  })

  it('returns items and nextBefore, and rejects bad filters', async () => {
    await signIn()
    const task = newTask({ title: 'Via API', order: 'a' })
    const { id, ...fields } = task
    sync.push(userId, [
      { id: ulid(), entityType: 'task', entityId: id, fields, ts: clock.now(), clientId: 'TEST' },
    ])
    const res = await app.request('/api/activity?kinds=added&limit=10', { headers: { cookie } })
    expect(res.status).toBe(200)
    const body = (await res.json()) as { items: ActivityItem[]; nextBefore: number | null }
    expect(brief(body.items)).toEqual(['added:Via API'])
    expect(body.nextBefore).toBeNull()

    for (const bad of ['kinds=nope', 'limit=0', 'limit=101', 'since=yesterday', 'actor=bob']) {
      const r = await app.request(`/api/activity?${bad}`, { headers: { cookie } })
      expect(r.status, bad).toBe(400)
      expect(((await r.json()) as { error: string }).error).toBe('invalid_query')
    }
  })

  it('limits an agent token to its grants', async () => {
    await signIn()
    const project = newProject({ title: 'Shared', order: 'a' })
    const inside = newTask({ title: 'Inside', projectId: project.id, order: 'a' })
    const outside = newTask({ title: 'Outside', order: 'b' })
    for (const [type, e] of [
      ['project', project],
      ['task', inside],
      ['task', outside],
    ] as const) {
      const { id, ...fields } = e
      sync.push(userId, [
        { id: ulid(), entityType: type, entityId: id, fields, ts: clock.now(), clientId: 'TEST' },
      ])
    }
    const created = await app.request('/api/agents', {
      method: 'POST',
      headers: { 'content-type': 'application/json', cookie },
      body: JSON.stringify({
        name: 'Bot',
        icon: 'bot',
        color: 'gray',
        grants: [{ scope: 'project', id: project.id, level: 'read' }],
      }),
    })
    const token = ((await created.json()) as { token: string }).token

    const res = await app.request('/api/activity', {
      headers: { authorization: `Bearer ${token}` },
    })
    const body = (await res.json()) as { items: ActivityItem[] }
    expect(brief(body.items)).toEqual(['added:Inside', 'added:Shared'])
  })
})

describe('a long log', () => {
  it('serves a page from 100k changes without reading them all', () => {
    const insert = database.sqlite.prepare(
      `insert into changes (user_id, id, client_id, entity_type, entity_id, fields, ts, received_at, actor)
       values (?, ?, 'BULK', 'task', ?, ?, ?, ?, null)`,
    )
    const tasks = Array.from({ length: 500 }, () => newTask({ title: 'Bulk', order: 'a' }))
    database.sqlite.transaction(() => {
      for (const t of tasks) {
        const { id, ...fields } = t
        sync.push(USER, [
          {
            id: ulid(),
            entityType: 'task',
            entityId: id,
            fields,
            ts: clock.now(),
            clientId: 'TEST',
          },
        ])
      }
      for (let i = 0; i < 100_000; i++) {
        wall += 7 * 60_000
        const task = tasks[i % tasks.length] as (typeof tasks)[number]
        insert.run(
          USER,
          ulid(),
          task.id,
          JSON.stringify({ title: `Bulk ${i}` }),
          clock.now(),
          new Date(wall).toISOString(),
        )
      }
    })()
    const started = performance.now()
    const page = list({ limit: 50 })
    const ms = performance.now() - started
    console.log(`activity page over 100k changes: ${ms.toFixed(1)} ms`)
    expect(page.items).toHaveLength(50)
    expect(page.items[0]?.fields[0]).toMatchObject({ field: 'title', to: 'Bulk 99999' })
    expect(page.items[0]?.fields[0]?.from).toBe('Bulk 99499')
    // Generous bound for slow CI; on a laptop this is a few milliseconds.
    expect(ms).toBeLessThan(500)

    // Worst case for `from`: a field last set at creation, 100k rows back.
    wall += 7 * 60_000
    write('task', (tasks[0] as (typeof tasks)[number]).id, { deadline: '2026-12-01' })
    let t0 = performance.now()
    const old = list({ limit: 1 })
    const oldMs = performance.now() - t0
    expect(old.items[0]?.fields).toEqual([{ field: 'deadline', from: null, to: '2026-12-01' }])

    // A filter that matches nothing reads at most the scan budget, then hands back a cursor.
    t0 = performance.now()
    const narrow = list({ kinds: ['deleted'] })
    const narrowMs = performance.now() - t0
    expect(narrow.items).toEqual([])
    expect(narrow.nextBefore).not.toBeNull()
    console.log(`worst-case from: ${oldMs.toFixed(1)} ms, narrow filter: ${narrowMs.toFixed(1)} ms`)
    expect(oldMs).toBeLessThan(1000)
  }, 60_000)
})
