import { createClock, newTask, type Task, ulid } from '@dingen/core'
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import { createApp } from './app.js'
import { openDatabase } from './db.js'
import { LATE_MS, ReminderPlanner } from './push/planner.js'
import { type PushPayload, PushService, type PushTarget, type SendResult } from './push/service.js'
import { loadVapidKeys } from './push/vapid.js'
import { reminderDeliveries } from './schema.js'

/** Nep-pushdienst: legt vast wat er verstuurd wordt; per endpoint een antwoord. */
const outbox: { endpoint: string; payload: PushPayload }[] = []
const answers = new Map<string, SendResult>()
async function fakeSender(target: PushTarget, payload: PushPayload): Promise<SendResult> {
  outbox.push({ endpoint: target.endpoint, payload })
  return answers.get(target.endpoint) ?? 'sent'
}

/** Nep-klok in UTC; Amsterdam is in november UTC+1. */
let clock = Date.parse('2026-11-12T08:00:00Z')

const database = openDatabase(':memory:')
const push = new PushService(database.db, 'test-public-key', fakeSender)
const app = createApp({
  db: database.db,
  version: 'test',
  sqliteVersion: database.sqliteVersion,
  registrationOpen: true,
  timezone: 'Europe/Amsterdam',
  push,
})
const planner = new ReminderPlanner(database.db, push, {
  timezone: 'Europe/Amsterdam',
  now: () => clock,
})
afterAll(() => database.close())

async function signUp(email: string): Promise<string> {
  const res = await app.request('/api/auth/register', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ email, password: 'wachtwoord123' }),
  })
  return res.headers.get('set-cookie')?.split(';')[0] ?? ''
}

function call(cookie: string, method: string, path: string, body?: unknown) {
  return app.request(path, {
    method,
    headers: { cookie, ...(body ? { 'content-type': 'application/json' } : {}) },
    body: body ? JSON.stringify(body) : undefined,
  })
}

const hlc = createClock('TEST', () => Date.now())

async function save(cookie: string, task: Task, fields?: Record<string, unknown>) {
  const { id, ...rest } = task
  const res = await call(cookie, 'POST', '/api/sync/push', {
    changes: [
      {
        id: ulid(),
        entityType: 'task',
        entityId: id,
        fields: fields ?? rest,
        ts: hlc.now(),
        clientId: 'test',
      },
    ],
  })
  if (res.status !== 200) throw new Error(await res.text())
}

const subscription = (endpoint: string) => ({
  endpoint,
  keys: { p256dh: 'BPubKey', auth: 'authSecret' },
})

describe('VAPID keys', () => {
  it('are generated once and kept in the database', () => {
    const db = openDatabase(':memory:')
    const first = loadVapidKeys(db.db, {})
    const second = loadVapidKeys(db.db, {})
    expect(first.publicKey).toMatch(/^[A-Za-z0-9_-]{80,}$/)
    expect(second).toEqual(first)
    db.close()
  })

  it('come from the environment when both are set', () => {
    const db = openDatabase(':memory:')
    const keys = loadVapidKeys(db.db, {
      DINGEN_VAPID_PUBLIC_KEY: 'pub',
      DINGEN_VAPID_PRIVATE_KEY: 'priv',
      DINGEN_VAPID_SUBJECT: 'mailto:beheer@example.org',
    })
    expect(keys).toEqual({
      publicKey: 'pub',
      privateKey: 'priv',
      subject: 'mailto:beheer@example.org',
    })
    db.close()
  })
})

describe('/api/push', () => {
  let alice = ''
  let bob = ''
  beforeAll(async () => {
    alice = await signUp('alice@example.org')
    bob = await signUp('bob@example.org')
  })

  it('needs a session', async () => {
    expect((await app.request('/api/push/key')).status).toBe(401)
  })

  it('gives the public key', async () => {
    const res = await call(alice, 'GET', '/api/push/key')
    expect(await res.json()).toEqual({ publicKey: 'test-public-key' })
  })

  it('subscribes once per device, and another account can take the device over', async () => {
    const endpoint = 'https://push.example.org/device-1'
    expect(
      (await call(alice, 'POST', '/api/push/subscriptions', subscription(endpoint))).status,
    ).toBe(201)
    expect(
      (await call(alice, 'POST', '/api/push/subscriptions', subscription(endpoint))).status,
    ).toBe(201)
    const users = () =>
      database.sqlite
        .prepare('select user_id from push_subscriptions where endpoint = ?')
        .all(endpoint)
    expect(users()).toHaveLength(1)
    await call(bob, 'POST', '/api/push/subscriptions', subscription(endpoint))
    expect(users()).toHaveLength(1)
    expect(push.count(await userIdOf(bob))).toBe(1)
    await call(bob, 'DELETE', '/api/push/subscriptions', { endpoint })
    expect(users()).toHaveLength(0)
  })

  it('refuses a bad subscription', async () => {
    expect(
      (await call(alice, 'POST', '/api/push/subscriptions', { endpoint: 'nope' })).status,
    ).toBe(400)
    expect(
      (
        await call(
          alice,
          'POST',
          '/api/push/subscriptions',
          subscription('http://push.example.org/x'),
        )
      ).status,
    ).toBe(400)
  })

  it('sends a test notification to every device of the user', async () => {
    outbox.length = 0
    await call(
      alice,
      'POST',
      '/api/push/subscriptions',
      subscription('https://push.example.org/a1'),
    )
    await call(
      alice,
      'POST',
      '/api/push/subscriptions',
      subscription('https://push.example.org/a2'),
    )
    const res = await call(alice, 'POST', '/api/push/test', { title: 'Test', body: 'Hallo' })
    expect(await res.json()).toEqual({ sent: 2 })
    expect(outbox.map((o) => o.payload.title)).toEqual(['Test', 'Test'])
    await call(alice, 'DELETE', '/api/push/subscriptions', {
      endpoint: 'https://push.example.org/a1',
    })
    await call(alice, 'DELETE', '/api/push/subscriptions', {
      endpoint: 'https://push.example.org/a2',
    })
  })
})

async function userIdOf(cookie: string): Promise<string> {
  const res = await call(cookie, 'GET', '/api/auth/me')
  return ((await res.json()) as { user: { id: string } }).user.id
}

describe('ReminderPlanner', () => {
  let carol = ''
  const endpoint = 'https://push.example.org/carol-phone'

  beforeAll(async () => {
    carol = await signUp('carol@example.org')
    await call(carol, 'POST', '/api/push/subscriptions', subscription(endpoint))
  })

  beforeEach(() => {
    outbox.length = 0
    answers.clear()
    clock = Date.parse('2026-11-12T08:00:00Z')
  })

  const reminderTask = (fields: Partial<Task> = {}) =>
    newTask({
      title: 'Bel de loodgieter',
      when: { kind: 'date', date: '2026-11-12' },
      time: '09:30',
      reminder: { daysBefore: 0, time: '09:30' },
      ...fields,
    })

  it('sends at the moment in DINGEN_TIMEZONE, once', async () => {
    const task = reminderTask()
    await save(carol, task)
    clock = Date.parse('2026-11-12T08:29:00Z') // 09:29 in Amsterdam
    expect(await planner.tick()).toBe(0)
    clock = Date.parse('2026-11-12T08:30:00Z') // 09:30
    expect(await planner.tick()).toBe(1)
    expect(outbox).toEqual([
      {
        endpoint,
        payload: { title: 'Bel de loodgieter', body: '09:30', tag: task.id, url: '/today' },
      },
    ])
    clock += 30_000
    expect(await planner.tick()).toBe(0)
    expect(outbox).toHaveLength(1)
  })

  it('counts daysBefore from the date and survives a moved reminder', async () => {
    const task = reminderTask({ reminder: { daysBefore: 1, time: '20:00' }, title: 'Vuilnis' })
    await save(carol, task)
    clock = Date.parse('2026-11-11T19:00:00Z') // 20:00 the evening before
    expect(await planner.tick()).toBe(1)
    // Moving the reminder gives a new moment, which goes out again.
    await save(carol, task, { reminder: { daysBefore: 1, time: '21:00' } })
    clock = Date.parse('2026-11-11T20:00:00Z')
    expect(await planner.tick()).toBe(1)
  })

  it('skips reminders that are more than an hour late, done or deleted', async () => {
    const late = reminderTask({
      title: 'Te laat',
      time: null,
      reminder: { daysBefore: 0, time: '06:00' },
    })
    const done = reminderTask({
      title: 'Klaar',
      status: 'completed',
      completedAt: new Date().toISOString(),
    })
    const gone = reminderTask({ title: 'Weg', deleted: true })
    for (const t of [late, done, gone]) await save(carol, t)
    clock = Date.parse('2026-11-12T05:00:00Z') + LATE_MS // 06:00 Amsterdam + 1 h
    await planner.tick()
    expect(outbox.map((o) => o.payload.title)).not.toContain('Te laat')
    expect(outbox.map((o) => o.payload.title)).not.toContain('Klaar')
    expect(outbox.map((o) => o.payload.title)).not.toContain('Weg')
  })

  it('sends a missed reminder within the hour, with the project in the text', async () => {
    const projectId = ulid()
    const { id: _id, ...project } = {
      id: projectId,
      createdAt: new Date().toISOString(),
      deleted: false,
      title: 'Verbouwing',
      notes: '',
      areaId: null,
      status: 'open',
      when: { kind: 'anytime' },
      deadline: null,
      tagIds: [],
      order: 'a0',
      completedAt: null,
    }
    await call(carol, 'POST', '/api/sync/push', {
      changes: [
        {
          id: ulid(),
          entityType: 'project',
          entityId: projectId,
          fields: project,
          ts: hlc.now(),
          clientId: 'test',
        },
      ],
    })
    const task = reminderTask({
      title: 'Tegels bestellen',
      projectId,
      reminder: { daysBefore: 0, time: '11:00' },
      time: '11:00',
    })
    await save(carol, task)
    clock = Date.parse('2026-11-12T10:45:00Z') // 11:45, 45 minutes late
    await planner.tick()
    expect(outbox.find((o) => o.payload.title === 'Tegels bestellen')?.payload.body).toBe(
      '11:00 · Verbouwing',
    )
  })

  it('drops a subscription the push service no longer knows', async () => {
    const extra = 'https://push.example.org/carol-old-laptop'
    await call(carol, 'POST', '/api/push/subscriptions', subscription(extra))
    answers.set(extra, 'gone')
    await save(
      carol,
      reminderTask({ title: 'Opruimen', reminder: { daysBefore: 0, time: '15:00' } }),
    )
    clock = Date.parse('2026-11-12T14:00:00Z')
    await planner.tick()
    expect(outbox.map((o) => o.endpoint).sort()).toEqual([endpoint, extra].sort())
    expect(push.count(await userIdOf(carol))).toBe(1)
  })

  it('does nothing for users without a device, and never runs twice at once', async () => {
    const dave = await signUp('dave@example.org')
    await save(dave, reminderTask({ title: 'Niemand', reminder: { daysBefore: 0, time: '16:00' } }))
    await save(
      carol,
      reminderTask({ title: 'Een keer', reminder: { daysBefore: 0, time: '16:00' } }),
    )
    clock = Date.parse('2026-11-12T15:00:00Z')
    const [a, b] = await Promise.all([planner.tick(), planner.tick()])
    expect(a).toBe(1)
    expect(b).toBe(1)
    expect(outbox.map((o) => o.payload.title)).toEqual(['Een keer'])
  })

  it('cleans up old deliveries', async () => {
    clock = Date.parse('2026-12-01T12:00:00Z')
    await planner.tick()
    expect(database.db.select().from(reminderDeliveries).all()).toHaveLength(0)
  })
})
