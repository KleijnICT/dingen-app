import {
  type Area,
  type ChecklistItem,
  dueReviews,
  entitySchemas,
  type Heading,
  type Project,
  type Review,
  type Tag,
  type Task,
  views,
} from '@dingen/core'
import { eq } from 'drizzle-orm'
import { afterEach, describe, expect, it } from 'vitest'
import { createApp } from './app.js'
import { openDatabase } from './db.js'
import { DEMO_ACCOUNTS } from './demo/accounts.js'
import { buildDemoSet } from './demo/dataset.js'
import { resetToDemo } from './demo/seed.js'
import { todayIn } from './demo/time.js'
import { users } from './schema.js'
import { SyncService } from './sync.js'

const timezone = 'Europe/Amsterdam'
const now = new Date('2026-11-12T10:30:00Z')
const today = todayIn(timezone, now)

const opened: { close: () => void }[] = []
afterEach(() => {
  for (const db of opened.splice(0)) db.close()
})

function freshDb() {
  const database = openDatabase(':memory:')
  opened.push(database)
  return database
}

interface Lists {
  tasks: Task[]
  projects: Project[]
  areas: Area[]
  headings: Heading[]
  tags: Tag[]
  checklist: ChecklistItem[]
  reviews: Review[]
}

function listsOf(sync: SyncService, userId: string): Lists {
  const { entities } = sync.snapshot(userId)
  const of = <T>(type: string) =>
    entities.filter((e) => e.entityType === type).map((e) => e.data as T)
  return {
    tasks: of<Task>('task'),
    projects: of<Project>('project'),
    areas: of<Area>('area'),
    headings: of<Heading>('heading'),
    tags: of<Tag>('tag'),
    checklist: of<ChecklistItem>('checklistItem'),
    reviews: of<Review>('review'),
  }
}

describe('demo set', () => {
  it('builds only valid entities with unique ids', () => {
    const set = buildDemoSet({ now, timezone, today })
    for (const records of Object.values(set)) {
      const ids = new Set<string>()
      for (const r of records) {
        expect(entitySchemas[r.entityType].strict().safeParse(r.data).success).toBe(true)
        expect(ids.has(`${r.entityType}:${r.id}`)).toBe(false)
        ids.add(`${r.entityType}:${r.id}`)
        for (const field of Object.keys(r.data)) {
          if (field !== 'id') expect(r.fieldTs[field]).toBeTruthy()
        }
      }
    }
  })

  it('never puts a completion or creation in the future', () => {
    for (const records of Object.values(buildDemoSet({ now, timezone, today }))) {
      for (const r of records) {
        for (const field of ['createdAt', 'completedAt', 'reviewedAt', 'startedAt']) {
          const value = r.data[field]
          if (typeof value === 'string') expect(Date.parse(value)).toBeLessThan(now.getTime())
        }
      }
    }
  })

  it('fills every list for Sam and makes the weekly review due', async () => {
    const { db } = freshDb()
    const result = await resetToDemo(db, { timezone, now })
    const sam = result.users.find((u) => u.email === 'sam@example.com')
    expect(sam).toBeDefined()
    const ws = listsOf(new SyncService(db), sam?.id as string)

    const live = views.available(
      ws.tasks.filter((t) => t.repeat === null),
      ws.projects,
    )
    const inbox = views.inbox(live)
    expect(inbox.length).toBeGreaterThanOrEqual(5)
    expect(inbox.length).toBeLessThanOrEqual(7)

    const todayList = views.today(views.notInSomedayProject(live, ws.projects), today)
    expect(todayList.filter((t) => !t.evening).length).toBeGreaterThanOrEqual(4)
    expect(todayList.filter((t) => t.evening).length).toBeGreaterThanOrEqual(2)

    const upcoming = views.upcoming(live, today)
    expect(upcoming.length).toBeGreaterThanOrEqual(8)
    expect(upcoming.some((t) => t.time !== null && t.reminder !== null)).toBe(true)

    expect(views.anytime(live, today).length).toBeGreaterThanOrEqual(10)
    expect(views.someday(live).length).toBeGreaterThanOrEqual(2)
    expect(ws.projects.filter(views.isSomeday).length).toBeGreaterThanOrEqual(2)

    const logbook = views.logbook(ws.tasks)
    expect(logbook.length).toBeGreaterThanOrEqual(15)
    expect(ws.projects.filter(views.isLogbook)).toHaveLength(1)

    expect(views.openAreas(ws.areas).map((a) => a.title)).toEqual([
      'Clients',
      'Business',
      'Home',
      'Health',
      'Friends & Family',
    ])
    expect(ws.tags.map((t) => t.title).sort()).toEqual(
      ['15 min', 'Calls', 'Computer', 'Errands', 'Waiting'].sort(),
    )
    expect(ws.headings.length).toBeGreaterThanOrEqual(7)
    expect(ws.checklist.length).toBeGreaterThanOrEqual(20)
    expect(ws.tasks.filter((t) => t.repeat !== null).length).toBeGreaterThanOrEqual(3)
    // Every template has exactly one open instance.
    for (const template of ws.tasks.filter((t) => t.repeat !== null)) {
      const open = ws.tasks.filter((t) => t.templateId === template.id && t.status === 'open')
      expect(open, template.title).toHaveLength(1)
    }
    expect(dueReviews(ws.reviews, today)).toContain('weekly')
    expect(dueReviews(ws.reviews, today)).not.toContain('monthly')
  })

  it('gives Morgan a smaller set and the new account nothing', async () => {
    const { db } = freshDb()
    const result = await resetToDemo(db, { timezone, now })
    const sync = new SyncService(db)
    const morgan = result.users.find((u) => u.email === 'morgan@example.com')
    const fresh = result.users.find((u) => u.email === 'new@example.com')
    const ws = listsOf(sync, morgan?.id as string)
    expect(views.openAreas(ws.areas).map((a) => a.title)).toEqual(['Home', 'Health', 'School'])
    expect(ws.tasks.some((t) => t.title.includes('plumber'))).toBe(true)
    expect(sync.hasEntities(fresh?.id as string)).toBe(false)
  })
})

describe('demo reset', () => {
  it('wipes existing accounts and makes Sam the only admin', async () => {
    const { db, sqliteVersion } = freshDb()
    const app = createApp({ db, version: 't', sqliteVersion, registrationOpen: true })
    const res = await app.request('/api/auth/register', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ email: 'someone@example.com', password: 'password123' }),
    })
    expect(res.status).toBe(201)

    await resetToDemo(db, { timezone, now })
    const rows = db.select().from(users).all()
    expect(rows.map((u) => u.email).sort()).toEqual(DEMO_ACCOUNTS.map((a) => a.email).sort())
    expect(rows.filter((u) => u.isAdmin).map((u) => u.email)).toEqual(['sam@example.com'])
    expect(db.select().from(users).where(eq(users.email, 'someone@example.com')).get()).toBe(
      undefined,
    )

    // Running it again gives the same accounts, not doubles.
    await resetToDemo(db, { timezone, now })
    expect(db.select().from(users).all()).toHaveLength(DEMO_ACCOUNTS.length)
  })
})

describe('demo sign-in', () => {
  it('is not there without demo mode', async () => {
    const { db, sqliteVersion } = freshDb()
    await resetToDemo(db, { timezone, now })
    const app = createApp({ db, version: 't', sqliteVersion })
    expect((await app.request('/api/auth/demo')).status).toBe(404)
    expect((await app.request('/api/auth/demo/sam@example.com', { method: 'POST' })).status).toBe(
      404,
    )
    const status = await (await app.request('/api/auth/status')).json()
    expect(status.demo).toBeUndefined()
  })

  it('lists the accounts and signs in without a password in demo mode', async () => {
    const { db, sqliteVersion } = freshDb()
    await resetToDemo(db, { timezone, now })
    const app = createApp({ db, version: 't', sqliteVersion, demo: true })

    const status = await (await app.request('/api/auth/status')).json()
    expect(status.demo).toBe(true)
    expect(status.registration).toBe('closed')

    const list = await (await app.request('/api/auth/demo')).json()
    expect(list.accounts.map((a: { email: string }) => a.email)).toEqual(
      DEMO_ACCOUNTS.map((a) => a.email),
    )

    const res = await app.request('/api/auth/demo/sam@example.com', { method: 'POST' })
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.user.email).toBe('sam@example.com')
    expect(body.user.isAdmin).toBe(true)
    const cookie = (res.headers.get('set-cookie') ?? '').split(';')[0] as string
    const me = await app.request('/api/auth/me', { headers: { cookie } })
    expect((await me.json()).user.email).toBe('sam@example.com')

    expect(
      (await app.request('/api/auth/demo/someone@example.com', { method: 'POST' })).status,
    ).toBe(404)
  })

  it('does not let a password open a demo account', async () => {
    const { db, sqliteVersion } = freshDb()
    await resetToDemo(db, { timezone, now })
    const app = createApp({ db, version: 't', sqliteVersion, demo: true })
    const res = await app.request('/api/auth/login', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ email: 'sam@example.com', password: 'password123' }),
    })
    expect(res.status).toBe(401)
  })
})
