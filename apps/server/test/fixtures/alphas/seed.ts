/**
 * Seeds a database with the code of an older release, for the migration
 * tests (see generate.sh). It runs inside a checkout of that release, in
 * apps/server, so everything goes through that version's own migrations,
 * validation and HTTP API: the data is what that version really wrote.
 *
 *   npx tsx seed.ts <database file> <version>
 *
 * It has to work on every release from 1.0.0-alpha.1 on: features that a
 * release does not have yet (agents, dayparts, assignees, review frequency)
 * are detected and left out. Keep it that way when adding to it.
 */
import * as core from '@dingen/core'
import { createApp } from './src/app.js'
import { openDatabase } from './src/db.js'

type Fields = Record<string, unknown>
// biome-ignore lint/suspicious/noExplicitAny: the factories differ per release
const factories = core as any

const [databasePath, version] = process.argv.slice(2)
if (!databasePath || !version) {
  console.error('Usage: tsx seed.ts <database file> <version>')
  process.exit(2)
}

const database = openDatabase(databasePath)
const app = createApp({
  db: database.db,
  version,
  sqliteVersion: database.sqliteVersion,
  registrationOpen: true,
  timezone: 'Europe/Amsterdam',
  fetchFeed: async () =>
    'BEGIN:VCALENDAR\r\nVERSION:2.0\r\nPRODID:-//fixture//EN\r\nEND:VCALENDAR\r\n',
} as Parameters<typeof createApp>[0])

const clock = core.createClock('FIXTURE')

async function call(path: string, init: RequestInit & { auth?: string } = {}) {
  const { auth, ...rest } = init
  const headers: Record<string, string> = { 'content-type': 'application/json' }
  if (auth?.startsWith('Bearer ')) headers.authorization = auth
  else if (auth) headers.cookie = auth
  // Every protocol header a release may want; older ones ignore it.
  headers['x-dingen-protocol'] = String((core as { SYNC_PROTOCOL?: number }).SYNC_PROTOCOL ?? 1)
  return app.request(path, { ...rest, headers: { ...headers, ...(rest.headers ?? {}) } })
}

async function register(email: string): Promise<string> {
  const res = await call('/api/auth/register', {
    method: 'POST',
    body: JSON.stringify({ email, password: 'password123' }),
  })
  if (!res.ok) throw new Error(`register ${email}: ${res.status} ${await res.text()}`)
  return res.headers.get('set-cookie')?.split(';')[0] ?? ''
}

/** A new entity as a change, from the release's own factory plus `extra` it knows. */
function created(entityType: string, entity: Fields, extra: Fields = {}) {
  const known = Object.fromEntries(Object.entries(extra).filter(([k]) => k in entity))
  const { id, ...fields } = { ...entity, ...known }
  return { change: change(entityType, id as string, fields), id: id as string }
}

function change(entityType: string, entityId: string, fields: Fields) {
  return {
    id: core.ulid(),
    entityType,
    entityId,
    fields,
    ts: clock.now(),
    clientId: 'FIXTURE',
  }
}

async function push(auth: string, changes: unknown[]) {
  const res = await call('/api/sync/push', {
    method: 'POST',
    auth,
    body: JSON.stringify({ changes }),
  })
  if (!res.ok) throw new Error(`push: ${res.status} ${await res.text()}`)
}

const day = (d: number) => `2026-11-${String(d).padStart(2, '0')}`
const at = (d: number) => `${day(d)}T09:00:00.000Z`

// --- accounts ---
const owner = await register('owner@example.com')
const second = await register('second@example.com')

// An agent (from alpha.3), else an API token of the owner.
let agentAuth = ''
const agentRes = await call('/api/agents', {
  method: 'POST',
  auth: owner,
  body: JSON.stringify({
    name: 'Claude',
    icon: 'bot',
    color: 'purple',
    grants: [{ scope: 'all', level: 'manage' }],
  }),
})
if (agentRes.ok) {
  agentAuth = `Bearer ${((await agentRes.json()) as { token: string }).token}`
} else {
  const tokenRes = await call('/api/auth/tokens', {
    method: 'POST',
    auth: owner,
    body: JSON.stringify({ name: 'Claude' }),
  })
  if (!tokenRes.ok) throw new Error(`token: ${tokenRes.status}`)
  agentAuth = `Bearer ${((await tokenRes.json()) as { token: string }).token}`
}

// --- the owner's data ---
const home = created('area', factories.newArea({ title: 'Home', order: 'a0' }), {
  icon: 'home',
  color: 'green',
  reviewEvery: { n: 2, unit: 'week' },
})
const work = created('area', factories.newArea({ title: 'Work', order: 'a1' }), {
  icon: 'briefcase',
  color: 'blue',
})
// Capitals: older releases kept them; the tag migration lowercases them.
const errand = created('tag', factories.newTag({ title: 'Errand', order: 'a0' }))
const phone = created('tag', factories.newTag({ title: 'Phone', order: 'a1' }))
const shed = created(
  'project',
  factories.newProject({
    title: 'Paint the shed',
    order: 'a0',
    areaId: home.id,
    deadline: day(30),
    tagIds: [errand.id],
    notes: 'Before the winter',
  }),
  { reviewedAt: at(10) },
)
const prep = created(
  'heading',
  factories.newHeading({ title: 'Prepare', projectId: shed.id, order: 'a0' }),
)
const doIt = created(
  'heading',
  factories.newHeading({ title: 'Paint', projectId: shed.id, order: 'a1' }),
)
// Evening with a reminder: `evening: true` before dayparts, `daypart` after.
const paint = created(
  'task',
  factories.newTask({
    title: 'Buy paint',
    order: 'a0',
    projectId: shed.id,
    headingId: prep.id,
    when: { kind: 'date', date: day(25) },
    tagIds: [errand.id],
  }),
  { evening: true, daypart: 'evening', reminder: { daysBefore: 0, time: '18:30' } },
)
// A time of day before dayparts; afternoon and a duration after.
const painter = created(
  'task',
  factories.newTask({
    title: 'Call the painter',
    order: 'a1',
    areaId: work.id,
    when: { kind: 'date', date: day(24) },
    tagIds: [phone.id],
  }),
  { time: '14:30', daypart: 'afternoon', duration: 30 },
)
const brush = created(
  'checklistItem',
  factories.newChecklistItem({ title: 'Brush', taskId: paint.id, order: 'a0' }),
)
const white = created(
  'checklistItem',
  factories.newChecklistItem({ title: 'White', taskId: paint.id, order: 'a1', done: true }),
)
const sand = created(
  'task',
  factories.newTask({
    title: 'Sand the boards',
    order: 'a2',
    projectId: shed.id,
    headingId: doIt.id,
  }),
)
const repeat = {
  unit: 'week',
  every: 1,
  basis: 'schedule',
  weekdays: [6],
  start: day(21),
  until: null,
  deadlineDays: null,
}
const plants = created(
  'task',
  factories.newTask({
    title: 'Water the plants',
    order: 'a3',
    areaId: home.id,
    when: { kind: 'date', date: day(21) },
    repeat,
  }),
)
const plantsNow = created(
  'task',
  factories.newTask({
    title: 'Water the plants',
    order: 'a4',
    areaId: home.id,
    when: { kind: 'date', date: day(21) },
    templateId: plants.id,
  }),
)
const done = created(
  'task',
  factories.newTask({
    title: 'Old errand',
    order: 'a5',
    status: 'completed',
    completedAt: at(15),
    when: { kind: 'anytime' },
  }),
)
const mistake = created('task', factories.newTask({ title: 'Mistake', order: 'a6' }))
const inbox = created('task', factories.newTask({ title: 'Inbox thought', order: 'a7' }))
const someday = created(
  'task',
  factories.newTask({ title: 'Learn to sail', order: 'a8', when: { kind: 'someday' } }),
)
const finished = created(
  'project',
  factories.newProject({
    title: 'Finished project',
    order: 'a1',
    areaId: work.id,
    status: 'completed',
    completedAt: at(12),
  }),
)
const changes = [
  home,
  work,
  errand,
  phone,
  shed,
  prep,
  doIt,
  paint,
  painter,
  brush,
  white,
  sand,
  plants,
  plantsNow,
  done,
  mistake,
  inbox,
  someday,
  finished,
].map((c) => c.change)
// The step-by-step review, while it existed (gone in protocol 4).
if (typeof factories.newReview === 'function') {
  const review = factories.newReview({ kind: 'weekly' })
  const { id, ...fields } = review
  changes.push(change('review', id, { ...fields, doneSteps: ['mindSweep'], completedAt: at(16) }))
}
await push(owner, changes)

// Edits and a deletion: more rows in the change log.
await push(owner, [
  change('task', paint.id, { title: 'Buy paint and tape', notes: 'Masking tape too' }),
  change('checklistItem', brush.id, { done: true }),
  change('task', mistake.id, { deleted: true }),
  change('task', sand.id, { status: 'completed', completedAt: at(18) }),
])

// The agent adds a task (assigned to the owner where tasks have an assignee).
const ownerMember = await (await call('/api/auth/me', { auth: owner })).json()
const assignee = `user:${(ownerMember as { user: { id: string } }).user.id}`
const fromAgent = created(
  'task',
  factories.newTask({ title: 'Book the scaffolding', order: 'a9', projectId: shed.id }),
  { assigneeId: assignee },
)
await push(agentAuth, [fromAgent.change])

// --- the second account: its own data, apart from the owner's ---
const secondArea = created('area', factories.newArea({ title: 'Garden', order: 'a0' }))
const secondTask = created(
  'task',
  factories.newTask({ title: 'Rake the leaves', order: 'a0', areaId: secondArea.id }),
)
await push(second, [secondArea.change, secondTask.change])

// A calendar subscription.
await call('/api/calendars', {
  method: 'POST',
  auth: owner,
  body: JSON.stringify({ name: 'Holidays', url: 'https://example.com/holidays.ics' }),
})

// No signing keys in a committed file: the server makes new ones when they are missing.
database.sqlite.prepare("delete from meta where key like 'vapid_%'").run()
database.close()
console.log(`Seeded ${databasePath} as ${version}`)
