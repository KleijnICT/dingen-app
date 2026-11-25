import { afterEach, describe, expect, it, vi } from 'vitest'
import * as actions from './actions.js'
import { addDays, addMonths, addYears, dayOfMonth, daysBetween, weekdayOf } from './dates.js'
import { daypartOf, daypartStartTime } from './dayparts.js'
import { fitsDuration, formatDuration, totalDuration } from './duration.js'
import {
  type Area,
  type Change,
  type ChecklistItem,
  type Daypart,
  type Entity,
  type EntityType,
  entitySchemas,
  type Heading,
  type Project,
  type Reminder,
  type Repeat,
  type Tag,
  type Task,
  validateChangeFields,
  type When,
} from './entities.js'
import { newArea, newChecklistItem, newHeading, newProject, newTag, newTask } from './factories.js'
import { createClock, formatTimestamp, parseTimestamp } from './hlc.js'
import { firstOrder, orderBetween, ordersBetween, placeBlockAt } from './order.js'
import { mergeCursor, parseCursorParam, requestProtocol, SYNC_PROTOCOL } from './protocol.js'
import { reminderFields, reminderMoment } from './reminders.js'
import { addInterval, checklistMirror, firstOccurrence, matches, nextOccurrence } from './repeat.js'
import { applyChange, type EntityRecord } from './sync.js'
import { normalizeTagTitle, sameTagTitle } from './tags.js'
import * as views from './views.js'

/**
 * The conformance test set for clients in other languages (spec/conformance).
 *
 * Every case is an operation with its input and the output of this package.
 * A native client runs the same cases against its own code; see
 * spec/conformance/README.md for what each operation means.
 *
 * The files are generated here and pinned: a change in behaviour makes this
 * test fail and shows up as a diff of the JSON in review. After an intended
 * change: raise `CONFORMANCE_VERSION`, run
 * `pnpm --filter @dingen/core test -u`, and commit the files with the change.
 */
const CONFORMANCE_VERSION = 1

const DIR = '../../../spec/conformance'

interface Case {
  name: string
  op: string
  input: unknown
  expected: unknown
}

const suites: { suite: string; description: string; cases: Case[] }[] = []

function suite(name: string, description: string, build: (add: AddCase) => void): void {
  const cases: Case[] = []
  build((caseName, op, input, expected) => {
    cases.push({ name: caseName, op, input, expected: clone(expected) })
  })
  suites.push({ suite: name, description, cases })
}
type AddCase = (name: string, op: string, input: unknown, expected: unknown) => void

/** JSON round trip: what a client reads from the file (no undefined, no Map). */
function clone<T>(value: T): T {
  return value === undefined ? (null as T) : (JSON.parse(JSON.stringify(value)) as T)
}

// --- fixed ids and times, so the files never change by themselves ---

const KIND = { area: 'A', project: 'P', heading: 'H', task: 'T', checklistItem: 'C', tag: 'G' }
/** A readable, valid ULID: `0000000000000000000000T001`. */
function id(kind: keyof typeof KIND, n: number): string {
  return `${'0'.repeat(22)}${KIND[kind]}${String(n).padStart(3, '0')}`
}
const CREATED = '2026-01-05T08:00:00.000Z'
const NOW = '2026-03-10T09:30:00.000Z'
const TODAY = '2026-03-10' // a Tuesday

function task(n: number, fields: Partial<Task> = {}): Task {
  return {
    ...newTask({ title: `Task ${n}` }),
    id: id('task', n),
    createdAt: CREATED,
    order: `a${n}`,
    ...fields,
  }
}
function project(n: number, fields: Partial<Project> = {}): Project {
  return {
    ...newProject({ title: `Project ${n}` }),
    id: id('project', n),
    createdAt: CREATED,
    order: `a${n}`,
    ...fields,
  }
}
function area(n: number, fields: Partial<Area> = {}): Area {
  return {
    ...newArea({ title: `Area ${n}` }),
    id: id('area', n),
    createdAt: CREATED,
    order: `a${n}`,
    ...fields,
  }
}
function heading(n: number, projectId: string, fields: Partial<Heading> = {}): Heading {
  return {
    ...newHeading({ title: `Heading ${n}`, projectId }),
    id: id('heading', n),
    createdAt: CREATED,
    order: `a${n}`,
    ...fields,
  }
}
function item(n: number, taskId: string, fields: Partial<ChecklistItem> = {}): ChecklistItem {
  return {
    ...newChecklistItem({ title: `Item ${n}`, taskId }),
    id: id('checklistItem', n),
    createdAt: CREATED,
    order: `a${n}`,
    ...fields,
  }
}
function tag(n: number, fields: Partial<Tag> = {}): Tag {
  return {
    ...newTag({ title: `tag ${n}` }),
    id: id('tag', n),
    createdAt: CREATED,
    order: `a${n}`,
    ...fields,
  }
}
const on = (date: string): When => ({ kind: 'date', date })
const rule = (fields: Partial<Repeat> = {}): Repeat => ({
  unit: 'day',
  every: 1,
  basis: 'schedule',
  weekdays: [],
  start: '2026-03-02',
  until: null,
  deadlineDays: null,
  ...fields,
})

// --- hlc ---

suite('hlc', 'Timestamps of the hybrid logical clock.', (add) => {
  for (const [wall, counter, clientId] of [
    [1767600000000, 0, 'ABCD1234'],
    [1767600000000, 7, 'ABCD1234'],
    [1, 99999, 'Z'],
    [0, 0, '0'],
  ] as const) {
    add(
      `format ${wall}/${counter}`,
      'format',
      { wall, counter, clientId },
      formatTimestamp(wall, counter, clientId),
    )
  }
  for (const ts of ['001767600000000:00000:ABCD1234', '000000000000001:99999:Z']) {
    add(`parse ${ts}`, 'parse', { ts }, parseTimestamp(ts))
  }
  const compare = (a: string, b: string) => (a < b ? -1 : a > b ? 1 : 0)
  for (const [a, b] of [
    ['001767600000000:00000:ABCD1234', '001767600000001:00000:ABCD1234'],
    ['001767600000000:00002:ABCD1234', '001767600000000:00010:ABCD1234'],
    ['001767600000000:00000:B', '001767600000000:00000:A'],
    ['001767600000000:00000:A', '001767600000000:00000:A'],
    ['000999999999999:99999:Z', '001000000000000:00000:A'],
  ] as const) {
    add(`compare ${a} with ${b}`, 'compare', { a, b }, compare(a, b))
  }

  type Step = { do: 'now'; wall: number } | { do: 'receive'; wall: number; remote: string }
  const run = (clientId: string, steps: Step[]) => {
    let wall = 0
    const clock = createClock(clientId, () => wall)
    const out: (string | null)[] = []
    for (const step of steps) {
      wall = step.wall
      if (step.do === 'now') out.push(clock.now())
      else {
        clock.receive(step.remote)
        out.push(null)
      }
    }
    return out
  }
  const sequences: [string, Step[]][] = [
    [
      'the wall clock moves on',
      [
        { do: 'now', wall: 1000 },
        { do: 'now', wall: 1001 },
        { do: 'now', wall: 1005 },
      ],
    ],
    [
      'several stamps in one millisecond',
      [
        { do: 'now', wall: 1000 },
        { do: 'now', wall: 1000 },
        { do: 'now', wall: 1000 },
        { do: 'now', wall: 1001 },
      ],
    ],
    [
      'the wall clock jumps back',
      [
        { do: 'now', wall: 5000 },
        { do: 'now', wall: 4000 },
        { do: 'now', wall: 4500 },
        { do: 'now', wall: 5001 },
      ],
    ],
    [
      'a remote stamp from the future',
      [
        { do: 'now', wall: 1000 },
        { do: 'receive', wall: 1001, remote: '000000000009000:00004:REMOTE' },
        { do: 'now', wall: 1002 },
        { do: 'now', wall: 1003 },
        { do: 'now', wall: 9001 },
      ],
    ],
    [
      'a remote stamp from the past',
      [
        { do: 'now', wall: 5000 },
        { do: 'receive', wall: 5000, remote: '000000000001000:00009:REMOTE' },
        { do: 'now', wall: 5000 },
      ],
    ],
    [
      'a remote stamp in the same millisecond',
      [
        { do: 'now', wall: 5000 },
        { do: 'now', wall: 5000 },
        { do: 'receive', wall: 4000, remote: '000000000005000:00007:REMOTE' },
        { do: 'now', wall: 4000 },
      ],
    ],
    [
      'a remote stamp, local wall clock ahead of both',
      [
        { do: 'now', wall: 1000 },
        { do: 'receive', wall: 8000, remote: '000000000002000:00003:REMOTE' },
        { do: 'now', wall: 8000 },
      ],
    ],
  ]
  for (const [name, steps] of sequences) {
    add(name, 'clock', { clientId: 'LOCAL', steps }, run('LOCAL', steps))
  }
})

// --- apply-change ---

suite('apply-change', 'Applying changes to a record: last writer wins per field.', (add) => {
  const taskId = id('task', 1)
  const ch = (n: number, ts: string, fields: Record<string, unknown>): Change => ({
    id: `${'0'.repeat(22)}X${String(n).padStart(3, '0')}`,
    entityType: 'task',
    entityId: taskId,
    fields,
    ts,
    clientId: ts.split(':')[2] as string,
  })
  const run = (existing: EntityRecord | null, changes: Change[]) => {
    let record = existing ?? undefined
    for (const change of changes) record = applyChange(record, change)
    return record
  }
  const { id: _id, ...full } = task(1, { title: 'Buy milk' })
  const t1 = '000000000001000:00000:A'
  const t2 = '000000000002000:00000:B'
  const t3 = '000000000003000:00000:A'
  const cases: [string, EntityRecord | null, Change[]][] = [
    ['a create makes the record', null, [ch(1, t1, full)]],
    ['a later change wins', null, [ch(1, t1, full), ch(2, t2, { title: 'Buy oat milk' })]],
    [
      'an older change that arrives late loses on that field only',
      null,
      [
        ch(1, t1, full),
        ch(2, t3, { title: 'Newest title' }),
        ch(3, t2, { title: 'Late title', notes: 'Late notes' }),
      ],
    ],
    [
      'changes to different fields merge',
      null,
      [ch(1, t1, full), ch(2, t2, { notes: 'From B' }), ch(3, t3, { title: 'From A' })],
    ],
    [
      'the same stamp again changes nothing',
      null,
      [ch(1, t1, full), ch(2, t1, { title: 'Same stamp' })],
    ],
    ['deleting is a field', null, [ch(1, t1, full), ch(2, t2, { deleted: true })]],
    [
      'a change after a deletion still applies',
      null,
      [ch(1, t1, full), ch(2, t2, { deleted: true }), ch(3, t3, { title: 'Still renamed' })],
    ],
    ['an id in the fields is ignored', null, [ch(1, t1, { ...full, id: taskId })]],
    [
      'an unknown field is kept',
      null,
      [ch(1, t1, full), ch(2, t2, { fieldFromTheFuture: { any: 'value' } })],
    ],
    [
      'onto an existing record',
      { entityType: 'task', id: taskId, data: { id: taskId, ...full }, fieldTs: { title: t2 } },
      [ch(1, t1, { title: 'Older', notes: 'No stamp yet, so this wins' })],
    ],
  ]
  for (const [name, existing, changes] of cases) {
    add(name, 'apply', { existing, changes }, run(existing, changes))
  }
})

// --- order ---

suite('order', 'Order keys (fractional indexing) and sorting.', (add) => {
  add('the first key', 'between', { before: null, after: null }, firstOrder())
  const pairs: [string | null, string | null][] = [
    ['a0', null],
    [null, 'a0'],
    ['a0', 'a1'],
    ['a0', 'a0V'],
    ['a0V', 'a1'],
    ['az', null],
    ['Zz', 'a0'],
    [null, 'Zz'],
    ['a1', 'a2'],
    ['a0G', 'a0V'],
    ['b00', null],
    ['zzzzzzzzzzzzzzzzzzzzzzzzzzz', null],
  ]
  for (const [before, after] of pairs) {
    add(`between ${before} and ${after}`, 'between', { before, after }, orderBetween(before, after))
  }
  const blocks: [string | null, string | null, number][] = [
    [null, null, 5],
    ['a0', null, 3],
    [null, 'a0', 3],
    ['a0', 'a1', 4],
    ['a0', 'a1', 1],
    [null, null, 0],
  ]
  for (const [before, after, n] of blocks) {
    add(
      `${n} keys between ${before} and ${after}`,
      'nBetween',
      { before, after, n },
      ordersBetween(before, after, n),
    )
  }

  const row = (...orders: string[]) => orders.map((order, i) => ({ id: id('task', i + 1), order }))
  const place = (siblings: { id: string; order: string }[], index: number, count: number) => {
    const { orders, renumber } = placeBlockAt(siblings, index, count, (s) => s.order)
    return { orders, renumber: Object.fromEntries(renumber) }
  }
  const places: [string, { id: string; order: string }[], number, number][] = [
    ['into an empty row', [], 0, 1],
    ['at the start', row('a0', 'a1', 'a2'), 0, 1],
    ['in the middle', row('a0', 'a1', 'a2'), 1, 1],
    ['at the end', row('a0', 'a1', 'a2'), 3, 1],
    ['a block of three in the middle', row('a0', 'a1'), 1, 3],
    ['between two equal keys: the row is renumbered', row('a0', 'a1', 'a1', 'a2'), 2, 1],
    ['all keys equal', row('a0', 'a0', 'a0'), 1, 2],
    ['neighbours out of order', row('a0', 'a5', 'a3'), 2, 1],
    ['renumbering keeps keys that are already right', row('a0', 'a1', 'a1'), 2, 1],
  ]
  for (const [name, siblings, index, count] of places) {
    add(name, 'place', { siblings, index, count }, place(siblings, index, count))
  }

  const sorted = (items: { id: string; order: string }[]) =>
    [...items].sort(views.byOrder).map((i) => i.id)
  const mixed = [
    { id: id('task', 3), order: 'a1' },
    { id: id('task', 1), order: 'a1' },
    { id: id('task', 2), order: 'Zz' },
    { id: id('task', 5), order: 'a0V' },
    { id: id('task', 4), order: 'a0' },
    { id: id('task', 6), order: 'B' },
    { id: id('task', 7), order: 'b' },
  ]
  add('by order, then by id', 'sort', { items: mixed }, sorted(mixed))
})

// --- dates ---

suite('dates', 'Arithmetic with calendar dates (YYYY-MM-DD), without time zones.', (add) => {
  for (const [date, days] of [
    ['2026-03-10', 1],
    ['2026-03-10', -10],
    ['2026-12-31', 1],
    ['2026-01-01', -1],
    ['2028-02-28', 1],
    ['2026-02-28', 1],
    ['2026-03-28', 2],
    ['2026-10-24', 2],
    ['2026-03-10', 0],
    ['2026-03-10', 3650],
  ] as const) {
    add(`${date} + ${days} days`, 'addDays', { date, days }, addDays(date, days))
  }
  const months: [string, number, number | null][] = [
    ['2026-01-31', 1, null],
    ['2028-01-31', 1, null],
    ['2026-03-31', -1, null],
    ['2026-11-15', 3, null],
    ['2026-02-28', 1, 31],
    ['2026-02-28', 2, 31],
    ['2026-01-15', 0, 31],
    ['2026-02-10', 0, 30],
    ['2026-05-31', 12, null],
    ['2026-05-31', -17, null],
  ]
  for (const [date, n, day] of months) {
    add(
      `${date} + ${n} months${day === null ? '' : `, day ${day}`}`,
      'addMonths',
      { date, months: n, dayOfMonth: day },
      addMonths(date, n, day ?? undefined),
    )
  }
  const years: [string, number, number | null][] = [
    ['2028-02-29', 1, null],
    ['2028-02-29', 4, null],
    ['2027-02-28', 1, 29],
    ['2026-07-04', -2, null],
  ]
  for (const [date, n, day] of years) {
    add(
      `${date} + ${n} years${day === null ? '' : `, day ${day}`}`,
      'addYears',
      { date, years: n, dayOfMonth: day },
      addYears(date, n, day ?? undefined),
    )
  }
  for (const date of ['2026-03-08', '2026-03-09', '2026-03-14', '2028-02-29', '2000-01-01']) {
    add(`weekday of ${date}`, 'weekday', { date }, weekdayOf(date))
    add(`day of the month of ${date}`, 'dayOfMonth', { date }, dayOfMonth(date))
  }
  for (const [from, to] of [
    ['2026-03-10', '2026-03-10'],
    ['2026-03-10', '2026-03-11'],
    ['2026-03-10', '2026-03-01'],
    ['2026-03-27', '2026-03-30'],
    ['2026-10-23', '2026-10-26'],
    ['2026-01-01', '2027-01-01'],
    ['2028-01-01', '2029-01-01'],
  ] as const) {
    add(`days from ${from} to ${to}`, 'daysBetween', { from, to }, daysBetween(from, to))
  }
})

// --- repeat ---

suite('repeat', 'Repeat rules: which dates fit, and the next occurrence.', (add) => {
  const rules: [string, Repeat][] = [
    ['every day', rule()],
    ['every 3 days', rule({ every: 3 })],
    ['every week, weekday of the start (Monday)', rule({ unit: 'week' })],
    ['every week on Monday and Thursday', rule({ unit: 'week', weekdays: [1, 4] })],
    ['every 2 weeks on Tuesday and Sunday', rule({ unit: 'week', every: 2, weekdays: [2, 0] })],
    [
      'every 2 weeks, start on a Sunday',
      rule({ unit: 'week', every: 2, start: '2026-03-08', weekdays: [0, 3] }),
    ],
    ['every month on the 31st', rule({ unit: 'month', start: '2026-01-31' })],
    ['every 3 months on the 15th', rule({ unit: 'month', every: 3, start: '2026-01-15' })],
    ['every year on 29 February', rule({ unit: 'year', start: '2028-02-29' })],
    ['every 2 years', rule({ unit: 'year', every: 2, start: '2026-06-01' })],
    ['every day until 12 March', rule({ until: '2026-03-12' })],
    ['every week, with a deadline', rule({ unit: 'week', deadlineDays: 2 })],
    ['every 10 days after completion', rule({ every: 10, basis: 'completion' })],
    ['every 2 weeks after completion', rule({ unit: 'week', every: 2, basis: 'completion' })],
    [
      'every month after completion, start on the 31st',
      rule({ unit: 'month', basis: 'completion', start: '2026-01-31' }),
    ],
    [
      'every year after completion until 2027',
      rule({ unit: 'year', basis: 'completion', until: '2027-06-30' }),
    ],
    ['starts in the future', rule({ unit: 'week', start: '2026-04-01' })],
  ]
  const dates = [
    '2026-03-01',
    '2026-03-02',
    '2026-03-03',
    '2026-03-05',
    '2026-03-08',
    '2026-03-09',
    '2026-03-10',
    '2026-03-12',
    '2026-03-13',
    '2026-03-15',
    '2026-03-16',
    '2026-03-17',
    '2026-03-22',
    '2026-03-31',
    '2026-04-01',
    '2026-04-15',
    '2026-04-30',
    '2026-06-01',
    '2027-02-28',
    '2027-06-01',
    '2028-02-29',
    '2028-06-01',
    '2029-02-28',
    '2032-02-29',
  ]
  for (const [name, r] of rules) {
    if (r.basis === 'schedule') {
      add(
        `${name}: which dates fit`,
        'matches',
        { rule: r, dates },
        dates.filter((d) => matches(r, d)),
      )
    }
    for (const [after, notBefore] of [
      ['2026-03-02', '2026-03-02'],
      ['2026-03-10', '2026-03-10'],
      ['2026-03-05', '2026-03-10'],
      ['2026-03-12', '2026-03-10'],
      ['2026-01-01', '2026-01-01'],
      ['2027-06-01', '2027-06-01'],
    ] as const) {
      add(
        `${name}: next after ${after}, not before ${notBefore}`,
        'next',
        { rule: r, after, notBefore },
        nextOccurrence(r, after, notBefore),
      )
    }
    for (const today of ['2026-02-20', '2026-03-02', '2026-03-10']) {
      add(
        `${name}: first occurrence, today ${today}`,
        'first',
        { rule: r, today },
        firstOccurrence(r, today),
      )
    }
    add(
      `${name}: one interval after 2026-03-31`,
      'addInterval',
      { rule: r, date: '2026-03-31' },
      addInterval(r, '2026-03-31'),
    )
  }

  const t = id('task', 1)
  const tpl = id('task', 2)
  const mirrors: [string, ChecklistItem[], ChecklistItem[]][] = [
    [
      'nothing to do',
      [item(1, tpl), item(2, tpl)],
      [item(11, t, { title: 'Item 1' }), item(12, t, { title: 'Item 2', done: true })],
    ],
    [
      'a renamed item',
      [item(1, tpl), item(2, tpl)],
      [item(11, t, { title: 'Renamed' }), item(12, t, { title: 'Item 2' })],
    ],
    [
      'an added item',
      [item(1, tpl)],
      [item(11, t, { title: 'Item 1' }), item(12, t, { title: 'New' })],
    ],
    [
      'a removed item',
      [item(1, tpl), item(2, tpl), item(3, tpl)],
      [item(11, t, { title: 'Item 1' })],
    ],
    [
      'a reordered row',
      [item(1, tpl), item(2, tpl)],
      [
        item(12, t, { title: 'Item 2', order: 'a0' }),
        item(11, t, { title: 'Item 1', order: 'a5' }),
      ],
    ],
    [
      'deleted items do not count',
      [item(1, tpl), item(2, tpl, { deleted: true })],
      [item(11, t, { title: 'Item 1' }), item(12, t, { deleted: true })],
    ],
  ]
  for (const [name, templateItems, instanceItems] of mirrors) {
    add(
      `checklist of the template: ${name}`,
      'checklistMirror',
      { templateItems, instanceItems },
      checklistMirror(templateItems, instanceItems),
    )
  }
})

// --- views ---

interface World {
  tasks: Task[]
  projects: Project[]
  areas: Area[]
  headings: Heading[]
  tags: Tag[]
  checklist: ChecklistItem[]
}
const world = (w: Partial<World>): World => ({
  tasks: [],
  projects: [],
  areas: [],
  headings: [],
  tags: [],
  checklist: [],
  ...w,
})

suite(
  'views',
  'The lists: which tasks and projects are in Inbox, Today, Upcoming, Anytime, Someday and the Logbook, and in which order.',
  (add) => {
    const ids = (items: { id: string }[]) => items.map((i) => i.id)
    const lists = (w: World, today: string) => {
      const avail = views.available(w.tasks, w.projects)
      const upcoming = views.upcoming(avail, today)
      const upcomingProjects = w.projects
        .filter((p) => views.isUpcoming(p, today))
        .sort(views.byOrder)
      return {
        tasks: {
          inbox: ids(views.inbox(avail)),
          today: ids(views.today(avail, today)),
          upcoming: upcoming.map((t) => ({ id: t.id, date: views.upcomingDate(t, today) })),
          anytime: ids(views.anytime(views.notInSomedayProject(avail, w.projects), today)),
          someday: ids(views.someday(avail)),
          logbook: ids(views.logbook(w.tasks)),
        },
        projects: {
          today: ids(w.projects.filter((p) => views.isToday(p, today)).sort(views.byOrder)),
          upcoming: upcomingProjects.map((p) => ({ id: p.id, date: views.upcomingDate(p, today) })),
          someday: ids(w.projects.filter(views.isSomeday).sort(views.byOrder)),
          logbook: ids(w.projects.filter(views.isLogbook).sort(views.byCompletedDesc)),
        },
      }
    }

    const A1 = id('area', 1)
    const P1 = id('project', 1)
    const P2 = id('project', 2)
    const P3 = id('project', 3)
    const P4 = id('project', 4)
    const P5 = id('project', 5)
    const anytime: When = { kind: 'anytime' }
    const someday: When = { kind: 'someday' }
    const done = (at: string) => ({ status: 'completed' as const, completedAt: at })

    const everything = world({
      areas: [area(1)],
      projects: [
        project(1),
        project(2, { when: someday }),
        project(3, done('2026-03-01T10:00:00.000Z')),
        project(4, { when: on('2026-03-20'), deadline: '2026-04-01', areaId: A1 }),
        project(5, { deadline: '2026-03-09' }),
        project(6, { when: on(TODAY), deleted: true }),
        project(7, { status: 'canceled', completedAt: '2026-03-05T10:00:00.000Z' }),
      ],
      tasks: [
        task(1),
        task(2, { when: on(TODAY) }),
        task(3, { when: on('2026-03-09'), projectId: P1 }),
        task(4, { when: on('2026-03-11'), areaId: A1 }),
        task(5, { when: anytime, projectId: P1 }),
        task(6, { when: someday, areaId: A1 }),
        task(7, { when: anytime, areaId: A1, deadline: TODAY }),
        task(8, { when: anytime, areaId: A1, deadline: '2026-03-15' }),
        task(9, { when: someday, areaId: A1, deadline: '2026-03-08' }),
        task(10, { when: on('2026-03-20'), deadline: '2026-03-12', projectId: P1 }),
        task(11, { when: anytime, projectId: P2 }),
        task(12, { when: on(TODAY), projectId: P2 }),
        task(13, { when: anytime, projectId: P3 }),
        task(14, { ...done('2026-03-02T10:00:00.000Z'), when: anytime, projectId: P3 }),
        task(15, { ...done('2026-03-09T18:00:00.000Z'), when: on('2026-03-09') }),
        task(16, {
          status: 'canceled',
          completedAt: '2026-03-09T19:00:00.000Z',
          areaId: A1,
          when: anytime,
        }),
        task(17, { when: on(TODAY), deleted: true }),
        task(18, { when: anytime, areaId: A1, repeat: rule() }),
        task(19, { when: on(TODAY), areaId: A1, templateId: id('task', 18) }),
        task(20, { when: on(TODAY), todayOrder: 'Zz', areaId: A1 }),
        task(21, { when: on('2026-03-09'), todayOrder: 'a15', projectId: P4 }),
        task(22, { when: on('2026-03-11'), order: 'a0' }),
        task(23, { when: anytime, projectId: P5 }),
        task(24, { when: anytime, projectId: id('project', 6) }),
        task(25, { when: { kind: 'inbox' }, areaId: A1 }),
        task(26, { when: on('2026-03-11'), order: 'a0', projectId: P1 }),
        task(27, { ...done('2026-03-09T18:00:00.001Z'), deleted: true }),
      ],
    })
    for (const today of ['2026-03-08', TODAY, '2026-03-11', '2026-03-12', '2026-03-21']) {
      add(`every list on ${today}`, 'lists', { today, ...everything }, lists(everything, today))
    }
    const empty = world({})
    add('an empty account', 'lists', { today: TODAY, ...empty }, lists(empty, TODAY))

    const structure = world({
      areas: [area(2, { order: 'a1' }), area(1, { order: 'a1' }), area(3, { deleted: true })],
      projects: [
        project(1, { order: 'a2' }),
        project(2, { order: 'a1', areaId: A1 }),
        project(3, { order: 'a0', areaId: A1, when: someday }),
        project(4, { areaId: A1, status: 'completed', completedAt: NOW }),
        project(5, { order: 'a1' }),
      ],
      headings: [
        heading(1, P1, { order: 'a2' }),
        heading(2, P1, { order: 'a1' }),
        heading(3, P1, { deleted: true }),
        heading(4, P2),
      ],
      tasks: [
        task(1, { projectId: P1, when: anytime }),
        task(2, { projectId: P1, when: anytime, headingId: id('heading', 1), order: 'a0' }),
        task(3, { projectId: P1, when: anytime, ...done(NOW) }),
        task(4, { projectId: P1, when: anytime, status: 'canceled', completedAt: NOW }),
        task(5, { projectId: P1, when: anytime, deleted: true }),
        task(6, { projectId: P1, when: anytime, repeat: rule() }),
        task(7, { areaId: A1, when: anytime }),
        task(8, { areaId: A1, when: someday, order: 'a1' }),
        task(9, { projectId: P2, when: anytime }),
        task(10, { areaId: A1, when: anytime, ...done(NOW) }),
      ],
      checklist: [
        item(1, id('task', 1), { order: 'a2', done: true }),
        item(2, id('task', 1), { order: 'a1' }),
        item(3, id('task', 1), { deleted: true, done: true }),
        item(4, id('task', 2)),
      ],
    })
    const containers = (w: World) => ({
      areas: ids(views.openAreas(w.areas)),
      looseProjects: ids(views.projectsOf(w.projects, null)),
      projectsByArea: Object.fromEntries(
        w.areas.map((a) => [a.id, ids(views.projectsOf(w.projects, a.id))]),
      ),
      tasksByArea: Object.fromEntries(
        w.areas.map((a) => [a.id, ids(views.areaTasks(w.tasks, a.id))]),
      ),
      tasksByProject: Object.fromEntries(
        w.projects.map((p) => [p.id, ids(views.projectTasks(w.tasks, p.id))]),
      ),
      headingsByProject: Object.fromEntries(
        w.projects.map((p) => [p.id, ids(views.headingsOf(w.headings, p.id))]),
      ),
      progressByProject: Object.fromEntries(
        w.projects.map((p) => [p.id, views.progress(p.id, w.tasks)]),
      ),
      checklistByTask: Object.fromEntries(
        w.tasks.map((t) => {
          const items = views.checklistOf(w.checklist, t.id)
          return [t.id, { items: ids(items), ...views.checklistProgress(items) }]
        }),
      ),
    })
    add('areas, projects, headings and their tasks', 'containers', structure, containers(structure))
  },
)

// --- dayparts, duration, tags, reminders ---

suite('dayparts', 'Parts of the day.', (add) => {
  for (const time of ['00:00', '08:59', '11:59', '12:00', '13:30', '17:59', '18:00', '23:59']) {
    add(`the daypart of ${time}`, 'daypartOf', { time }, daypartOf(time))
  }
  for (const daypart of ['morning', 'afternoon', 'evening', null] as (Daypart | null)[]) {
    add(
      `the start of ${daypart ?? 'no daypart'}`,
      'startTime',
      { daypart },
      daypartStartTime(daypart),
    )
  }
})

suite('duration', 'Estimated duration in minutes.', (add) => {
  for (const minutes of [1, 5, 59, 60, 61, 90, 120, 125, 605, 1440]) {
    for (const hourUnit of ['h', 'u'] as const) {
      add(
        `${minutes} minutes, hour unit ${hourUnit}`,
        'format',
        { minutes, hourUnit },
        formatDuration(minutes, hourUnit),
      )
    }
  }
  const durations = [15, null, 30, 60, null, 5]
  add(
    'the total',
    'total',
    { durations },
    totalDuration(durations.map((duration) => ({ duration }))),
  )
  add('the total of nothing', 'total', { durations: [] }, totalDuration([]))
  for (const [duration, max] of [
    [15, 15],
    [16, 15],
    [null, 15],
    [null, null],
    [600, null],
    [5, 60],
  ] as const) {
    add(
      `does ${duration} fit in ${max}`,
      'fits',
      { duration, max },
      fitsDuration({ duration }, max),
    )
  }
})

suite('tags', 'Tag titles are lowercase, trimmed, with single spaces.', (add) => {
  for (const title of [
    'Work',
    '  Home  ',
    'Deep   Work',
    'ÉÉN ding',
    'at\tthe\noffice',
    'already fine',
    '',
    'ΑΒΓ',
  ]) {
    add(`normalize ${JSON.stringify(title)}`, 'normalize', { title }, normalizeTagTitle(title))
  }
  for (const [a, b] of [
    ['Work', 'work'],
    [' deep  work', 'Deep Work '],
    ['work', 'works'],
    ['één', 'ÉÉN'],
  ] as const) {
    add(
      `same tag: ${JSON.stringify(a)} and ${JSON.stringify(b)}`,
      'same',
      { a, b },
      sameTagTitle(a, b),
    )
  }
})

suite('reminders', 'When a reminder is due.', (add) => {
  const r = (daysBefore: number, time: string): Reminder => ({ daysBefore, time })
  const tasks: [string, Task][] = [
    ['on the day itself', task(1, { when: on(TODAY), reminder: r(0, '09:00') })],
    ['two days before', task(1, { when: on('2026-03-01'), reminder: r(2, '18:30') })],
    ['a year before', task(1, { when: on(TODAY), reminder: r(365, '00:00') })],
    ['no reminder', task(1, { when: on(TODAY) })],
    ['no date', task(1, { when: { kind: 'anytime' }, reminder: r(0, '09:00') })],
    [
      'completed',
      task(1, { when: on(TODAY), reminder: r(0, '09:00'), status: 'completed', completedAt: NOW }),
    ],
    [
      'canceled',
      task(1, { when: on(TODAY), reminder: r(0, '09:00'), status: 'canceled', completedAt: NOW }),
    ],
    ['deleted', task(1, { when: on(TODAY), reminder: r(0, '09:00'), deleted: true })],
    ['a template', task(1, { when: on(TODAY), reminder: r(0, '09:00'), repeat: rule() })],
  ]
  for (const [name, t] of tasks)
    add(`the moment: ${name}`, 'moment', { task: t }, reminderMoment(t))

  const sets: [string, Task, Reminder | null][] = [
    ['a new reminder', task(1, { when: on(TODAY) }), r(1, '08:00')],
    ['the same reminder', task(1, { when: on(TODAY), reminder: r(1, '08:00') }), r(1, '08:00')],
    ['another time', task(1, { when: on(TODAY), reminder: r(1, '08:00') }), r(1, '08:15')],
    ['removing it', task(1, { when: on(TODAY), reminder: r(1, '08:00') }), null],
    ['removing none', task(1, { when: on(TODAY) }), null],
    ['on a task without a date', task(1, { when: { kind: 'someday' } }), r(0, '09:00')],
  ]
  for (const [name, t, reminder] of sets) {
    add(`setting a reminder: ${name}`, 'fields', { task: t, reminder }, reminderFields(t, reminder))
  }
})

// --- protocol ---

suite('protocol', 'Small helpers of the sync protocol: cursors and the protocol header.', (add) => {
  const cursors: [Record<string, number>, Record<string, number> | null][] = [
    [{ s1: 5 }, { s1: 9 }],
    [{ s1: 9 }, { s1: 5 }],
    [{ s1: 5 }, { s2: 3 }],
    [
      { s1: 5, s2: 7 },
      { s2: 8, s3: 0 },
    ],
    [{ s1: 5 }, null],
    [{}, { s1: 1 }],
  ]
  for (const [base, update] of cursors) {
    add(
      `merge ${JSON.stringify(base)} with ${JSON.stringify(update)}`,
      'mergeCursor',
      { base, update },
      mergeCursor(base, update ?? undefined),
    )
  }
  for (const raw of [
    '{}',
    '{"s1":5}',
    '{"s1":5,"s2":0}',
    '',
    'null',
    '[]',
    '{"s1":-1}',
    '{"s1":1.5}',
    '{"s1":"5"}',
    '{"":1}',
    'not json',
  ]) {
    add(`parse the cursor ${JSON.stringify(raw)}`, 'parseCursor', { raw }, parseCursorParam(raw))
  }
  for (const header of ['4', '5', '1', '0', '-1', '4.5', 'four', '', null]) {
    add(
      `the protocol of header ${JSON.stringify(header)}`,
      'requestProtocol',
      { header },
      requestProtocol(header),
    )
  }
})

// --- entities ---

suite(
  'entities',
  'Entities: defaults for fields that are absent, what is valid, and a new entity.',
  (add) => {
    const parse = (entityType: EntityType, data: unknown) => {
      const result = entitySchemas[entityType].safeParse(data)
      return result.success ? { ok: true, entity: result.data } : { ok: false }
    }
    const minimal: [EntityType, Record<string, unknown>][] = [
      [
        'area',
        { id: id('area', 1), createdAt: CREATED, deleted: false, title: 'Home', order: 'a0' },
      ],
      [
        'project',
        {
          id: id('project', 1),
          createdAt: CREATED,
          deleted: false,
          title: 'Paint the fence',
          notes: '',
          areaId: null,
          status: 'open',
          when: { kind: 'anytime' },
          deadline: null,
          tagIds: [],
          order: 'a0',
          completedAt: null,
        },
      ],
      [
        'heading',
        {
          id: id('heading', 1),
          createdAt: CREATED,
          deleted: false,
          projectId: id('project', 1),
          title: 'Later',
          order: 'a0',
        },
      ],
      [
        'task',
        {
          id: id('task', 1),
          createdAt: CREATED,
          deleted: false,
          title: 'Buy paint',
          notes: '',
          status: 'open',
          projectId: null,
          headingId: null,
          areaId: null,
          when: { kind: 'inbox' },
          deadline: null,
          tagIds: [],
          repeat: null,
          order: 'a0',
          completedAt: null,
        },
      ],
      [
        'checklistItem',
        {
          id: id('checklistItem', 1),
          createdAt: CREATED,
          deleted: false,
          taskId: id('task', 1),
          title: 'Brush',
          done: false,
          order: 'a0',
        },
      ],
      [
        'tag',
        {
          id: id('tag', 1),
          createdAt: CREATED,
          deleted: false,
          title: 'errand',
          parentId: null,
          order: 'a0',
        },
      ],
    ]
    for (const [entityType, data] of minimal) {
      add(
        `a ${entityType} with only the required fields gets the defaults`,
        'parse',
        { entityType, data },
        parse(entityType, data),
      )
    }
    const base = minimal[3]?.[1] as Record<string, unknown>
    const variants: [string, Record<string, unknown>][] = [
      [
        'with a date, daypart, duration and reminder',
        {
          when: on(TODAY),
          daypart: 'evening',
          duration: 45,
          reminder: { daysBefore: 1, time: '20:00' },
        },
      ],
      ['with a repeat rule', { repeat: rule({ unit: 'week', weekdays: [1, 3] }) }],
      ['assigned to an agent', { assigneeId: 'agent:01JABCDEFGHJKMNPQRSTVWXYZ0' }],
      ['a time with an offset', { createdAt: '2026-01-05T09:00:00+01:00' }],
      ['a lowercase id', { id: id('task', 1).toLowerCase() }],
      ['an id with the letter I', { id: `${'0'.repeat(25)}I` }],
      ['an unknown status', { status: 'done' }],
      ['a date that is not a calendar date', { when: { kind: 'date', date: '10-03-2026' } }],
      ['a when without its date', { when: { kind: 'date' } }],
      ['a duration of 0', { duration: 0 }],
      ['a duration over a day', { duration: 1441 }],
      ['a duration that is not whole', { duration: 1.5 }],
      ['a reminder time of 24:00', { when: on(TODAY), reminder: { daysBefore: 0, time: '24:00' } }],
      ['an empty order', { order: '' }],
      ['a deadline with a time', { deadline: '2026-03-10T00:00:00Z' }],
      ['without a title', { title: undefined }],
      ['a weekday 7 in the rule', { repeat: rule({ unit: 'week', weekdays: [7] }) }],
      ['an interval of 0', { repeat: rule({ every: 0 }) }],
    ]
    for (const [name, fields] of variants) {
      const data = clone({ ...base, ...fields })
      add(`a task ${name}`, 'parse', { entityType: 'task', data }, parse('task', data))
    }

    const change = (fields: Record<string, unknown>, entityType: EntityType = 'task'): Change => ({
      id: `${'0'.repeat(22)}X001`,
      entityType,
      entityId: id(entityType, 1),
      fields,
      ts: '000000000001000:00000:A',
      clientId: 'A',
    })
    const { id: _baseId, ...createFields } = base
    const existing = clone(task(1))
    const validations: [string, Change, Record<string, unknown> | null][] = [
      ['a create with every required field', change(createFields), null],
      ['a create that lacks a required field', change({ title: 'Only a title' }), null],
      ['a create with an unknown field', change({ ...createFields, color: 'red' }), null],
      [
        'a create with its own id in the fields',
        change({ ...createFields, id: id('task', 1) }),
        null,
      ],
      [
        'a create with another id in the fields',
        change({ ...createFields, id: id('task', 2) }),
        null,
      ],
      ['a change of one field', change({ title: 'Renamed' }), existing],
      ['a change with a wrong value', change({ status: 'done' }), existing],
      ['a change with an unknown field', change({ color: 'red' }), existing],
      ['a deletion', change({ deleted: true }), existing],
      [
        'a change on data that still has retired fields',
        change({ title: 'Renamed' }),
        { ...existing, evening: false, time: null },
      ],
      ['a change that sets a retired field', change({ evening: true }), existing],
    ]
    for (const [name, ch, current] of validations) {
      add(
        name,
        'validateChange',
        { change: ch, existing: current },
        { ok: validateChangeFields(ch, current ?? undefined).ok },
      )
    }

    vi.useFakeTimers({ toFake: ['Date'] })
    vi.setSystemTime(new Date(NOW))
    const fresh = (entity: Entity) => ({ ...entity, id: '$1' })
    add(
      'a new task',
      'new',
      { now: NOW, entityType: 'task', fields: { title: 'Call the plumber' } },
      fresh(newTask({ title: 'Call the plumber' })),
    )
    add(
      'a new project',
      'new',
      { now: NOW, entityType: 'project', fields: { title: 'Fix the leak' } },
      fresh(newProject({ title: 'Fix the leak' })),
    )
    add(
      'a new area',
      'new',
      { now: NOW, entityType: 'area', fields: { title: 'Home' } },
      fresh(newArea({ title: 'Home' })),
    )
    add(
      'a new heading',
      'new',
      { now: NOW, entityType: 'heading', fields: { title: 'Later', projectId: id('project', 1) } },
      fresh(newHeading({ title: 'Later', projectId: id('project', 1) })),
    )
    add(
      'a new checklist item',
      'new',
      { now: NOW, entityType: 'checklistItem', fields: { title: 'Wrench', taskId: id('task', 1) } },
      fresh(newChecklistItem({ title: 'Wrench', taskId: id('task', 1) })),
    )
    add(
      'a new tag',
      'new',
      { now: NOW, entityType: 'tag', fields: { title: '  Deep  WORK ' } },
      fresh(newTag({ title: '  Deep  WORK ' })),
    )
    vi.useRealTimers()
  },
)

// --- actions ---

type Action =
  | { kind: 'toggleTask'; taskId: string }
  | { kind: 'deleteTask'; taskId: string }
  | { kind: 'changeTask'; taskId: string; fields: Record<string, unknown> }
  | { kind: 'moveTask'; taskId: string; target: actions.MoveTarget }
  | { kind: 'setRepeat'; taskId: string; rule: Repeat }
  | { kind: 'stopRepeat'; taskId: string }
  | { kind: 'duplicateTask'; taskId: string }
  | { kind: 'convertTaskToProject'; taskId: string }
  | { kind: 'changeChecklist'; taskId: string; items: ChecklistItem[] }
  | { kind: 'toggleProject'; projectId: string }
  | { kind: 'deleteProject'; projectId: string }
  | { kind: 'deleteArea'; areaId: string }

type Write =
  | { write: 'create'; entityType: EntityType; entity: Entity }
  | { write: 'change'; entityType: EntityType; entityId: string; fields: Record<string, unknown> }

function perform(w: World, today: string, action: Action): Write[] {
  const live = <T extends { deleted: boolean }>(items: T[]) => items.filter((i) => !i.deleted)
  const ws = actions.buildSnapshot(today, {
    tasks: live(w.tasks),
    projects: live(w.projects),
    areas: live(w.areas),
    headings: live(w.headings),
    tags: live(w.tags),
    checklist: live(w.checklist),
  })
  const writes: Write[] = []
  const writer: actions.Writer = {
    create: (entityType, entity) => writes.push({ write: 'create', entityType, entity }),
    mutate: (entityType, entityId, fields) =>
      writes.push({ write: 'change', entityType, entityId, fields }),
  }
  const find = <T extends { id: string }>(items: T[], wanted: string): T => {
    const found = items.find((i) => i.id === wanted)
    if (!found) throw new Error(`No entity ${wanted}`)
    return found
  }
  vi.useFakeTimers({ toFake: ['Date'] })
  vi.setSystemTime(new Date(NOW))
  try {
    switch (action.kind) {
      case 'toggleTask':
        actions.toggleTask(writer, ws, find(ws.tasks, action.taskId))
        break
      case 'deleteTask':
        actions.deleteTask(writer, ws, find(ws.tasks, action.taskId))
        break
      case 'changeTask':
        actions.commitTask(writer, ws, find(ws.tasks, action.taskId), action.fields)
        break
      case 'moveTask':
        actions.moveTask(writer, ws, find(ws.tasks, action.taskId), action.target)
        break
      case 'setRepeat':
        actions.setRepeat(writer, ws, find(ws.tasks, action.taskId), action.rule)
        break
      case 'stopRepeat':
        actions.stopRepeat(writer, ws, find(ws.tasks, action.taskId))
        break
      case 'duplicateTask':
        actions.duplicateTask(writer, ws, find(ws.tasks, action.taskId))
        break
      case 'convertTaskToProject':
        actions.convertTaskToProject(writer, ws, find(ws.tasks, action.taskId))
        break
      case 'changeChecklist':
        actions.mirrorChecklist(writer, ws, find(ws.tasks, action.taskId), action.items)
        break
      case 'toggleProject':
        actions.toggleProject(writer, find(ws.projects, action.projectId))
        break
      case 'deleteProject':
        actions.deleteProject(writer, ws, find(ws.projects, action.projectId))
        break
      case 'deleteArea':
        actions.deleteArea(writer, ws, find(ws.areas, action.areaId))
        break
    }
  } finally {
    vi.useRealTimers()
  }
  // New ids are random: name them `$1`, `$2`, … in the order they are created.
  let text = JSON.stringify(writes)
  let n = 0
  for (const write of writes) {
    if (write.write === 'create') text = text.replaceAll(write.entity.id, `$${++n}`)
  }
  return JSON.parse(text) as Write[]
}

suite(
  'actions',
  'What the app writes when the user does something: completing, deleting, moving, repeating.',
  (add) => {
    const A1 = id('area', 1)
    const P1 = id('project', 1)
    const H1 = id('heading', 1)
    const T = (n: number) => id('task', n)
    const run = (name: string, w: World, action: Action, today = TODAY) => {
      add(name, action.kind, { now: NOW, today, ...w, action }, perform(w, today, action))
    }

    // Completing and reopening
    run('complete a plain task', world({ tasks: [task(1)] }), { kind: 'toggleTask', taskId: T(1) })
    run(
      'reopen a completed task',
      world({ tasks: [task(1, { status: 'completed', completedAt: '2026-03-09T10:00:00.000Z' })] }),
      { kind: 'toggleTask', taskId: T(1) },
    )
    run(
      'reopen a canceled task',
      world({ tasks: [task(1, { status: 'canceled', completedAt: '2026-03-09T10:00:00.000Z' })] }),
      { kind: 'toggleTask', taskId: T(1) },
    )

    // Repeating: the next instance
    const daily = (extra: Partial<Task> = {}, r: Partial<Repeat> = {}): World =>
      world({
        areas: [area(1)],
        tasks: [
          task(1, {
            title: 'Water the plants',
            when: { kind: 'anytime' },
            areaId: A1,
            repeat: rule(r),
            daypart: 'morning',
            duration: 10,
            reminder: { daysBefore: 0, time: '08:00' },
            tagIds: [id('tag', 1)],
            notes: 'Not the cactus',
            ...extra,
          }),
          task(2, {
            title: 'Water the plants',
            when: on(TODAY),
            areaId: A1,
            templateId: T(1),
            daypart: 'morning',
            duration: 10,
            reminder: { daysBefore: 0, time: '08:00' },
            tagIds: [id('tag', 1)],
            notes: 'Not the cactus',
            todayOrder: 'a0',
          }),
          task(3, { when: { kind: 'anytime' }, areaId: A1, order: 'a7' }),
        ],
        tags: [tag(1)],
        checklist: [
          item(1, T(1)),
          item(2, T(1), { order: 'a0' }),
          item(3, T(1), { deleted: true }),
          item(4, T(2), { done: true }),
          item(5, T(2), { order: 'a0', done: true }),
        ],
      })
    run(
      'complete an instance of a daily task: the next one appears, with a fresh checklist',
      daily(),
      { kind: 'toggleTask', taskId: T(2) },
    )
    run(
      'complete an instance late: a schedule skips the days that passed',
      {
        ...daily(),
        tasks: daily().tasks.map((t) => (t.id === T(2) ? { ...t, when: on('2026-03-05') } : t)),
      },
      { kind: 'toggleTask', taskId: T(2) },
    )
    run(
      'complete an instance planned ahead: the next one follows its own date',
      {
        ...daily({}, { unit: 'week', weekdays: [1, 4] }),
        tasks: daily({}, { unit: 'week', weekdays: [1, 4] }).tasks.map((t) =>
          t.id === T(2) ? { ...t, when: on('2026-03-16') } : t,
        ),
      },
      { kind: 'toggleTask', taskId: T(2) },
    )
    run(
      'complete an instance, repeat after completion: the interval counts from today',
      {
        ...daily({}, { basis: 'completion', every: 10 }),
        tasks: daily({}, { basis: 'completion', every: 10 }).tasks.map((t) =>
          t.id === T(2) ? { ...t, when: on('2026-03-01') } : t,
        ),
      },
      { kind: 'toggleTask', taskId: T(2) },
    )
    run('complete an instance with a deadline rule', daily({}, { unit: 'week', deadlineDays: 3 }), {
      kind: 'toggleTask',
      taskId: T(2),
    })
    run('complete the last instance: the rule has ended', daily({}, { until: TODAY }), {
      kind: 'toggleTask',
      taskId: T(2),
    })
    run(
      'complete an instance whose template is gone',
      { ...daily(), tasks: daily().tasks.filter((t) => t.id !== T(1)) },
      { kind: 'toggleTask', taskId: T(2) },
    )
    const inProject = world({
      projects: [project(1)],
      headings: [heading(1, P1)],
      tasks: [
        task(1, {
          when: { kind: 'anytime' },
          projectId: P1,
          headingId: H1,
          repeat: rule({ unit: 'month', start: '2026-01-31' }),
        }),
        task(2, { when: on('2026-02-28'), projectId: P1, headingId: H1, templateId: T(1) }),
        task(3, { when: { kind: 'anytime' }, projectId: P1, headingId: H1, order: 'a5' }),
        task(4, { when: { kind: 'anytime' }, projectId: P1, order: 'a9' }),
      ],
    })
    run(
      'complete an instance under a heading: the next one goes below its siblings there',
      inProject,
      { kind: 'toggleTask', taskId: T(2) },
    )
    run(
      'reopen a completed instance: nothing else changes',
      {
        ...daily(),
        tasks: daily().tasks.map((t) =>
          t.id === T(2)
            ? { ...t, status: 'completed' as const, completedAt: '2026-03-10T08:00:00.000Z' }
            : t,
        ),
      },
      { kind: 'toggleTask', taskId: T(2) },
    )

    // Deleting
    run('delete a plain task', world({ tasks: [task(1)] }), { kind: 'deleteTask', taskId: T(1) })
    run('delete an open instance: that occurrence is skipped', daily(), {
      kind: 'deleteTask',
      taskId: T(2),
    })
    run(
      'delete an open instance, repeat after completion',
      daily({}, { basis: 'completion', every: 10 }),
      { kind: 'deleteTask', taskId: T(2) },
    )
    run(
      'delete a completed instance',
      {
        ...daily(),
        tasks: daily().tasks.map((t) =>
          t.id === T(2)
            ? { ...t, status: 'completed' as const, completedAt: '2026-03-10T08:00:00.000Z' }
            : t,
        ),
      },
      { kind: 'deleteTask', taskId: T(2) },
    )

    // Changing fields
    run('rename a plain task', world({ tasks: [task(1)] }), {
      kind: 'changeTask',
      taskId: T(1),
      fields: { title: 'Renamed' },
    })
    run('no fields, no write', world({ tasks: [task(1)] }), {
      kind: 'changeTask',
      taskId: T(1),
      fields: {},
    })
    run('rename an open instance: the template follows', daily(), {
      kind: 'changeTask',
      taskId: T(2),
      fields: { title: 'Water all plants', notes: '' },
    })
    run('change the date and deadline of an instance: the template does not follow', daily(), {
      kind: 'changeTask',
      taskId: T(2),
      fields: { when: on('2026-03-12'), deadline: '2026-03-14' },
    })
    run(
      'change daypart, duration, reminder and tags of an instance: the template follows',
      daily(),
      {
        kind: 'changeTask',
        taskId: T(2),
        fields: { daypart: 'evening', duration: 20, reminder: null, tagIds: [] },
      },
    )
    run(
      'move an instance to Someday: its daypart and reminder go, the template keeps them',
      daily(),
      { kind: 'changeTask', taskId: T(2), fields: { when: { kind: 'someday' } } },
    )
    run(
      'a plain task to Anytime without daypart or reminder: nothing to clear',
      world({ tasks: [task(1, { when: on(TODAY) })] }),
      { kind: 'changeTask', taskId: T(1), fields: { when: { kind: 'anytime' } } },
    )
    run(
      'change a completed instance: the template does not follow',
      {
        ...daily(),
        tasks: daily().tasks.map((t) =>
          t.id === T(2)
            ? { ...t, status: 'completed' as const, completedAt: '2026-03-10T08:00:00.000Z' }
            : t,
        ),
      },
      { kind: 'changeTask', taskId: T(2), fields: { title: 'Renamed afterwards' } },
    )

    // Moving
    const places = world({
      areas: [area(1), area(2)],
      projects: [project(1), project(2, { areaId: A1 })],
      headings: [heading(1, P1)],
      tasks: [
        task(1),
        task(2, { projectId: P1, when: { kind: 'anytime' }, order: 'a3' }),
        task(3, { projectId: P1, headingId: H1, when: { kind: 'anytime' }, order: 'a4' }),
        task(4, {
          areaId: A1,
          when: on(TODAY),
          daypart: 'afternoon',
          reminder: { daysBefore: 0, time: '13:00' },
          order: 'a6',
        }),
        task(5, { projectId: P1, when: { kind: 'anytime' }, order: 'a8', repeat: rule() }),
        task(6, {
          projectId: P1,
          when: { kind: 'anytime' },
          order: 'a9',
          status: 'completed',
          completedAt: CREATED,
        }),
      ],
    })
    const move = (name: string, taskId: string, target: actions.MoveTarget) =>
      run(`move: ${name}`, places, { kind: 'moveTask', taskId, target })
    move('from the Inbox to a project (becomes Anytime, lands at the end)', T(1), {
      kind: 'project',
      projectId: P1,
    })
    move('from the Inbox under a heading', T(1), { kind: 'project', projectId: P1, headingId: H1 })
    move('from the Inbox to an empty project', T(1), {
      kind: 'project',
      projectId: id('project', 2),
    })
    move('from the Inbox to an area', T(1), { kind: 'area', areaId: A1 })
    move('to the project it is already in', T(2), { kind: 'project', projectId: P1 })
    move('within a project, out of its heading', T(3), {
      kind: 'project',
      projectId: P1,
      headingId: null,
    })
    move('from a project to an area', T(2), { kind: 'area', areaId: A1 })
    move('from an area to a project: the date stays', T(4), { kind: 'project', projectId: P1 })
    move('to the area it is already in', T(4), { kind: 'area', areaId: A1 })
    move('to another date: the daypart stays', T(4), { kind: 'when', when: on('2026-03-12') })
    move('to the same date with another daypart', T(4), {
      kind: 'when',
      when: on(TODAY),
      daypart: 'evening',
    })
    move('to the same date without a daypart', T(4), {
      kind: 'when',
      when: on(TODAY),
      daypart: null,
    })
    move('to the same date and daypart', T(4), { kind: 'when', when: on(TODAY) })
    move('to Someday: daypart and reminder are cleared', T(4), {
      kind: 'when',
      when: { kind: 'someday' },
    })
    move('back to the Inbox: it loses its list too', T(4), {
      kind: 'when',
      when: { kind: 'inbox' },
    })
    move('an Inbox task to the Inbox', T(1), { kind: 'when', when: { kind: 'inbox' } })
    move('an Inbox task to today', T(1), { kind: 'when', when: on(TODAY), daypart: 'morning' })
    move('out of every list', T(2), { kind: 'none' })
    move('out of every list when it has none', T(1), { kind: 'none' })

    // Repeat rules
    const plain = world({
      areas: [area(1)],
      tasks: [
        task(1, {
          title: 'Pay the rent',
          areaId: A1,
          when: on('2026-03-20'),
          deadline: '2026-03-25',
          daypart: 'evening',
          todayOrder: 'a3',
          assigneeId: 'user:01JABCDEFGHJKMNPQRSTVWXYZ0',
        }),
      ],
      checklist: [
        item(1, T(1), { done: true }),
        item(2, T(1), { order: 'a0' }),
        item(3, T(1), { deleted: true }),
      ],
    })
    run('make a plain task repeat every month', plain, {
      kind: 'setRepeat',
      taskId: T(1),
      rule: rule({ unit: 'month', start: '2026-03-28', deadlineDays: 3 }),
    })
    run('make a task repeat, start in the past', plain, {
      kind: 'setRepeat',
      taskId: T(1),
      rule: rule({ unit: 'week', start: '2026-02-02', weekdays: [5] }),
    })
    run('make a task repeat after completion, start in the past', plain, {
      kind: 'setRepeat',
      taskId: T(1),
      rule: rule({ basis: 'completion', every: 30, start: '2026-01-01' }),
    })
    run('a rule whose end has passed: the task still goes to the start date', plain, {
      kind: 'setRepeat',
      taskId: T(1),
      rule: rule({ start: '2026-01-01', until: '2026-01-31' }),
    })
    run('change the rule of an instance', daily(), {
      kind: 'setRepeat',
      taskId: T(2),
      rule: rule({ unit: 'week', weekdays: [6], deadlineDays: 1 }),
    })
    run('stop repeating', daily(), { kind: 'stopRepeat', taskId: T(2) })
    run(
      'stop repeating when the template is gone',
      { ...daily(), tasks: daily().tasks.filter((t) => t.id !== T(1)) },
      { kind: 'stopRepeat', taskId: T(2) },
    )

    // Checklist of an instance
    run('add an item to the checklist of an instance: the template gets it too', daily(), {
      kind: 'changeChecklist',
      taskId: T(2),
      items: [
        item(5, T(2), { order: 'a0', done: true }),
        item(4, T(2), { done: true }),
        item(6, T(2), { title: 'New item', order: 'a9' }),
      ],
    })
    run('remove and rename items of an instance', daily(), {
      kind: 'changeChecklist',
      taskId: T(2),
      items: [item(5, T(2), { order: 'a0', title: 'Renamed' })],
    })
    run('the checklist of a plain task has no template to follow', world({ tasks: [task(1)] }), {
      kind: 'changeChecklist',
      taskId: T(1),
      items: [item(1, T(1))],
    })

    // Duplicating and converting
    const rows = world({
      projects: [project(1)],
      tasks: [
        task(1, {
          projectId: P1,
          when: on(TODAY),
          order: 'a1',
          todayOrder: 'a1',
          tagIds: [id('tag', 1)],
          deadline: '2026-03-12',
          assigneeId: 'agent:01JABCDEFGHJKMNPQRSTVWXYZ0',
          templateId: T(9),
          duration: 30,
        }),
        task(2, { projectId: P1, when: on(TODAY), order: 'a2', todayOrder: 'a4' }),
        task(3, { when: on(TODAY), order: 'a1V' }),
      ],
      checklist: [item(1, T(1), { done: true }), item(2, T(1), { order: 'a0' })],
    })
    run('duplicate a task: the copy sorts right below it, in every list', rows, {
      kind: 'duplicateTask',
      taskId: T(1),
    })
    run('duplicate the last task', rows, { kind: 'duplicateTask', taskId: T(2) })
    run('duplicate a task without a place in Today', rows, { kind: 'duplicateTask', taskId: T(3) })
    const convertible = world({
      areas: [area(1)],
      projects: [project(1, { areaId: A1, order: 'a4' }), project(2, { order: 'a2' })],
      tasks: [
        task(1, {
          title: 'Plan the party',
          notes: 'In June',
          tagIds: [id('tag', 1)],
          deadline: '2026-06-01',
          daypart: null,
          duration: 60,
        }),
        task(2, {
          areaId: A1,
          when: on('2026-04-01'),
          daypart: 'morning',
          reminder: { daysBefore: 1, time: '09:00' },
        }),
        task(3, { projectId: P1, when: { kind: 'someday' } }),
        task(4, { areaId: A1, when: on(TODAY), templateId: T(5) }),
        task(5, { areaId: A1, when: { kind: 'anytime' }, repeat: rule() }),
      ],
      checklist: [
        item(1, T(1), { title: 'Guest list', order: 'a1' }),
        item(2, T(1), { title: 'Book a room', order: 'a0', done: true }),
        item(3, T(1), { deleted: true }),
      ],
    })
    run('turn an Inbox task with a checklist into a project', convertible, {
      kind: 'convertTaskToProject',
      taskId: T(1),
    })
    run('turn a task in an area into a project', convertible, {
      kind: 'convertTaskToProject',
      taskId: T(2),
    })
    run('turn a task in a project into a project in the same area', convertible, {
      kind: 'convertTaskToProject',
      taskId: T(3),
    })
    run('turn an instance into a project: the next instance appears', convertible, {
      kind: 'convertTaskToProject',
      taskId: T(4),
    })

    // Projects and areas
    run(
      'complete a project',
      world({
        projects: [project(1)],
        tasks: [task(1, { projectId: P1, when: { kind: 'anytime' } })],
      }),
      { kind: 'toggleProject', projectId: P1 },
    )
    run(
      'reopen a project',
      world({ projects: [project(1, { status: 'completed', completedAt: CREATED })] }),
      { kind: 'toggleProject', projectId: P1 },
    )
    const tree = world({
      areas: [area(1), area(2)],
      projects: [
        project(1, { areaId: A1 }),
        project(2, { areaId: A1 }),
        project(3),
        project(4, { areaId: id('area', 2) }),
      ],
      headings: [heading(1, P1), heading(2, id('project', 2)), heading(3, id('project', 3))],
      tasks: [
        task(1, { projectId: P1, when: { kind: 'anytime' } }),
        task(2, {
          projectId: P1,
          when: { kind: 'anytime' },
          headingId: H1,
          status: 'completed',
          completedAt: CREATED,
        }),
        task(3, { projectId: id('project', 2), when: { kind: 'anytime' } }),
        task(4, { areaId: A1, when: { kind: 'anytime' } }),
        task(5, { projectId: id('project', 3), when: { kind: 'anytime' } }),
        task(6),
        task(7, { projectId: P1, when: { kind: 'anytime' }, repeat: rule() }),
        task(8, { areaId: id('area', 2), when: { kind: 'anytime' } }),
      ],
    })
    run('delete a project with its headings and tasks', tree, {
      kind: 'deleteProject',
      projectId: P1,
    })
    run('delete an area with everything in it', tree, { kind: 'deleteArea', areaId: A1 })
  },
)

// --- the files ---

afterEach(() => {
  vi.useRealTimers()
})

describe('conformance test set', () => {
  for (const s of suites) {
    it(`${s.suite} matches spec/conformance/${s.suite}.json`, async () => {
      const file = {
        suite: s.suite,
        version: CONFORMANCE_VERSION,
        description: s.description,
        cases: s.cases,
      }
      await expect(`${JSON.stringify(file, null, 2)}\n`).toMatchFileSnapshot(
        `${DIR}/${s.suite}.json`,
      )
    })
  }

  it('the manifest lists every suite', async () => {
    const manifest = {
      version: CONFORMANCE_VERSION,
      syncProtocol: SYNC_PROTOCOL,
      suites: suites.map((s) => ({
        suite: s.suite,
        file: `${s.suite}.json`,
        cases: s.cases.length,
      })),
    }
    await expect(`${JSON.stringify(manifest, null, 2)}\n`).toMatchFileSnapshot(
      `${DIR}/manifest.json`,
    )
  })

  it('case names are unique within a suite', () => {
    for (const s of suites) {
      const names = s.cases.map((c) => c.name)
      expect(new Set(names).size, s.suite).toBe(names.length)
    }
  })
})
