import { type ActorId, type Change, createClock, newTask, ulid } from '@dingen/core'
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import { createApp } from './app.js'
import { openDatabase } from './db.js'
import { type Assignment, taskUrl } from './push/assigned.js'
import { type PushPayload, PushService, type PushTarget } from './push/service.js'
import { createPersonalSpace } from './spaces/service.js'
import { SyncService } from './sync.js'

const clock = createClock('TEST')

function taskChange(entityId: string, fields: Record<string, unknown>): Change {
  return { id: ulid(), entityType: 'task', entityId, fields, ts: clock.now(), clientId: 'TEST' }
}

/** A push as `actor` in the personal space of `owner`. */
function pushAs(service: SyncService, owner: string, actor: ActorId, changes: Change[]) {
  return service.push(owner, changes, { access: { userId: owner, actor, grants: null } })
}

describe('assignment notifications: the trigger', () => {
  const database = openDatabase(':memory:')
  const seen: Assignment[][] = []
  const service = new SyncService(database.db, { onAssigned: (list) => seen.push(list) })
  database.sqlite
    .prepare(
      "insert into users (id, email, password_hash, created_at) values ('ann', 'ann@example.com', 'x', '2026-01-01')",
    )
    .run()
  createPersonalSpace(database.db, 'ann', '2026-01-01')
  afterAll(() => database.close())
  beforeEach(() => {
    seen.length = 0
  })

  function create(title: string, actor: ActorId = 'user:ann') {
    const { id, ...fields } = newTask({ title })
    pushAs(service, 'ann', actor, [taskChange(id, fields)])
    return id
  }

  it('an agent assigning a task to a person: one notification', () => {
    const id = create('Call the plumber')
    seen.length = 0
    pushAs(service, 'ann', 'agent:bot', [taskChange(id, { assigneeId: 'user:ann' })])
    expect(seen).toEqual([
      [
        {
          userId: 'ann',
          agentId: 'bot',
          taskId: id,
          title: 'Call the plumber',
          projectId: null,
          areaId: null,
        },
      ],
    ])
  })

  it('an agent creating a task assigned to a person: one notification', () => {
    const { id, ...fields } = newTask({ title: 'Read the report' })
    pushAs(service, 'ann', 'agent:bot', [taskChange(id, { ...fields, assigneeId: 'user:ann' })])
    expect(seen).toHaveLength(1)
    expect(seen[0]?.[0]?.taskId).toBe(id)
  })

  it('a person assigning (also to themselves): none', () => {
    const id = create('Water the plants')
    pushAs(service, 'ann', 'user:ann', [taskChange(id, { assigneeId: 'user:ann' })])
    expect(seen).toEqual([])
  })

  it('an agent sending the same assignee again: none', () => {
    const id = create('Book the hall')
    pushAs(service, 'ann', 'agent:bot', [taskChange(id, { assigneeId: 'user:ann' })])
    seen.length = 0
    pushAs(service, 'ann', 'agent:bot', [taskChange(id, { assigneeId: 'user:ann' })])
    expect(seen).toEqual([])
  })

  it('a replayed change (same id): none', () => {
    const id = create('Pay the invoice')
    const change = taskChange(id, { assigneeId: 'user:ann' })
    pushAs(service, 'ann', 'agent:bot', [change])
    seen.length = 0
    const again = pushAs(service, 'ann', 'agent:bot', [change])
    expect(again.duplicates).toBe(1)
    expect(seen).toEqual([])
  })

  it('an agent completing a task: none', () => {
    const id = create('Send the letter')
    pushAs(service, 'ann', 'user:ann', [taskChange(id, { assigneeId: 'user:ann' })])
    pushAs(service, 'ann', 'agent:bot', [
      taskChange(id, { status: 'completed', completedAt: new Date().toISOString() }),
    ])
    expect(seen).toEqual([])
  })

  it('an agent assigning to itself or another agent, or clearing: none', () => {
    const id = create('Sort the photos')
    pushAs(service, 'ann', 'agent:bot', [taskChange(id, { assigneeId: 'agent:bot' })])
    pushAs(service, 'ann', 'agent:bot', [taskChange(id, { assigneeId: null })])
    expect(seen).toEqual([])
  })

  it('an agent assigning a completed task: none', () => {
    const id = create('Old errand')
    pushAs(service, 'ann', 'user:ann', [
      taskChange(id, { status: 'completed', completedAt: new Date().toISOString() }),
    ])
    pushAs(service, 'ann', 'agent:bot', [taskChange(id, { assigneeId: 'user:ann' })])
    expect(seen).toEqual([])
  })

  it('a batch that is refused: none', () => {
    const id = create('Fix the bike')
    expect(() =>
      pushAs(service, 'ann', 'agent:bot', [
        taskChange(id, { assigneeId: 'user:ann' }),
        taskChange(ulid(), { title: 42 }),
      ]),
    ).toThrow()
    expect(seen).toEqual([])
  })
})

describe('taskUrl', () => {
  it('opens the task in its project, its area or Today', () => {
    expect(taskUrl({ taskId: 't1', projectId: 'p1', areaId: 'a1' })).toBe('/project/p1?task=t1')
    expect(taskUrl({ taskId: 't1', projectId: null, areaId: 'a1' })).toBe('/area/a1?task=t1')
    expect(taskUrl({ taskId: 't1', projectId: null, areaId: null })).toBe('/today?task=t1')
  })
})

describe('assignment notifications: over the API', () => {
  const outbox: { target: PushTarget; payload: PushPayload }[] = []
  const database = openDatabase(':memory:')
  const push = new PushService(database.db, 'test-public-key', async (target, payload) => {
    outbox.push({ target, payload })
    return 'sent'
  })
  const app = createApp({
    db: database.db,
    version: 'test',
    sqliteVersion: database.sqliteVersion,
    registrationOpen: true,
    push,
  })
  afterAll(() => database.close())

  let cookie = ''
  let userId = ''
  let agentAuth = ''
  beforeAll(async () => {
    const res = await app.request('/api/auth/register', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ email: 'owner@example.org', password: 'wachtwoord123' }),
    })
    cookie = res.headers.get('set-cookie')?.split(';')[0] ?? ''
    const me = await (await app.request('/api/auth/me', { headers: { cookie } })).json()
    userId = me.user.id
    const agentRes = await app.request('/api/agents', {
      method: 'POST',
      headers: { 'content-type': 'application/json', cookie },
      body: JSON.stringify({
        name: 'Claude',
        icon: 'bot',
        color: 'gray',
        grants: [{ scope: 'all', level: 'manage' }],
      }),
    })
    agentAuth = `Bearer ${(await agentRes.json()).token}`
    await app.request('/api/push/subscriptions', {
      method: 'POST',
      headers: { 'content-type': 'application/json', cookie },
      body: JSON.stringify({
        endpoint: 'https://push.example.org/device',
        keys: { p256dh: 'BPubKey', auth: 'authSecret' },
      }),
    })
  })

  async function sync(auth: Record<string, string>, changes: Change[]) {
    const res = await app.request('/api/sync/push', {
      method: 'POST',
      headers: { 'content-type': 'application/json', ...auth },
      body: JSON.stringify({ changes }),
    })
    expect(res.status).toBe(200)
  }

  /** Lets the fire-and-forget send finish. */
  const settle = () => new Promise((resolve) => setTimeout(resolve, 0))

  it('sends the assignee a push naming the agent, with the task title, opening the task', async () => {
    const { id, ...fields } = newTask({ title: 'Renew the passport' })
    await sync({ cookie }, [taskChange(id, fields)])
    await sync({ authorization: agentAuth }, [taskChange(id, { assigneeId: `user:${userId}` })])
    await settle()
    expect(outbox.map((o) => o.payload)).toEqual([
      {
        title: 'Claude assigned you a task',
        body: 'Renew the passport',
        tag: id,
        url: `/today?task=${id}`,
      },
    ])
  })

  it('sends nothing when the person assigns', async () => {
    outbox.length = 0
    const { id, ...fields } = newTask({ title: 'Buy stamps' })
    await sync({ cookie }, [taskChange(id, { ...fields, assigneeId: `user:${userId}` })])
    await settle()
    expect(outbox).toEqual([])
  })

  it("renders the push in each device's language, English without one", async () => {
    await app.request('/api/push/subscriptions', {
      method: 'POST',
      headers: { 'content-type': 'application/json', cookie },
      body: JSON.stringify({
        endpoint: 'https://push.example.org/dutch-phone',
        keys: { p256dh: 'BPubKey', auth: 'authSecret' },
        language: 'nl',
      }),
    })
    outbox.length = 0
    const { id, ...fields } = newTask({ title: '' })
    await sync({ cookie }, [taskChange(id, fields)])
    await sync({ authorization: agentAuth }, [taskChange(id, { assigneeId: `user:${userId}` })])
    await settle()
    const byDevice = Object.fromEntries(outbox.map((o) => [o.target.endpoint, o.payload]))
    expect(byDevice['https://push.example.org/device']).toMatchObject({
      title: 'Claude assigned you a task',
      body: 'Untitled',
    })
    expect(byDevice['https://push.example.org/dutch-phone']).toMatchObject({
      title: 'Claude heeft je een taak toegewezen',
      body: 'Zonder titel',
    })
  })
})
