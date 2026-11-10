import { applyChange, type Change, type EntityRecord, recordKey } from '@dingen/core'
import { describe, expect, it } from 'vitest'
import { DingenClient, type SyncTransport } from '../client.js'
import { describePlan, importTickTick, planTickTickImport, stableId } from './ticktick.js'
import {
  convertTickTickDump,
  parseTickTickDump,
  type TickTickApiTask,
  type TickTickDump,
} from './ticktick-api.js'

const task = (id: string, projectId: string, extra: Partial<TickTickApiTask> = {}) => ({
  id,
  projectId,
  sortOrder: 0,
  title: `Task ${id}`,
  content: '',
  desc: null,
  startDate: null,
  dueDate: null,
  timeZone: 'Europe/Amsterdam',
  isAllDay: true,
  priority: 0,
  reminders: null,
  repeatFlag: null,
  repeatFrom: null,
  completedTime: null,
  status: 0,
  items: null,
  tags: null,
  parentId: null,
  kind: 'TEXT',
  createdTime: '2026-10-02T10:43:10+0200',
  ...extra,
})

const DUMP: TickTickDump = {
  groups: [
    { id: 'g1', name: '💼 Acme', sortOrder: 200 },
    { id: 'g2', name: '🏡 Thuis', sortOrder: 100 },
  ],
  projects: [
    { id: 'p1', name: '📋Acme algemeen', sortOrder: 1, closed: null, groupId: 'g1' },
    { id: 'p2', name: '👮🏻‍♂Zonnebloem', sortOrder: 3, closed: null, groupId: 'g1' },
    { id: 'p3', name: 'Wasstraat', sortOrder: 2, closed: null, groupId: 'g1' },
    { id: 'p4', name: '🧺  Thuis   algemeen', sortOrder: 1, closed: null, groupId: 'g2' },
    { id: 'p7', name: 'Leeg project', sortOrder: 2, closed: null, groupId: 'g2' },
    { id: 'p5', name: '💭 Someday', sortOrder: null, closed: null, groupId: null },
    { id: 'p6', name: 'Oud project', sortOrder: 4, closed: true, groupId: 'g1' },
    { id: 'inbox1', name: 'Postvak', sortOrder: null, closed: null, groupId: null },
  ],
  tags: [
    { name: 'jordy', label: 'Jordy', sortOrder: 5, parent: 'personen' },
    { name: 'personen', label: 'Personen', parent: null },
    { name: 'waiting', label: 'Waiting', parent: '' },
    { name: 'ongebruikt', label: 'Ongebruikt', sortOrder: 9, parent: null },
  ],
  lists: [
    {
      project: { id: 'p1', name: '📋Acme algemeen', groupId: 'g1' },
      columns: [],
      tasks: [
        task('a1', 'p1', {
          sortOrder: 50,
          title: 'Late',
          tags: ['jordy'],
          isAllDay: false,
          startDate: '2026-11-15T23:30:00+0000',
          reminders: ['TRIGGER:PT0S'],
        }),
        task('a2', 'p1', { sortOrder: -10, title: 'Early' }),
        task('a3', 'p1', {
          sortOrder: 20,
          title: 'Middle',
          isAllDay: false,
          dueDate: '2026-11-20T09:00:00+0100',
        }),
      ],
    },
    {
      project: { id: 'p3', name: 'Wasstraat', groupId: 'g1' },
      columns: [{ id: 'col1', name: 'Doing' }],
      tasks: [
        task('c1', 'p3', {
          title: 'Order parts',
          kind: 'CHECKLIST',
          content: 'ignored when desc is set',
          desc: 'Remember the invoice',
          items: [
            { id: 'i2', status: 1, title: 'done item', sortOrder: 2 },
            { id: 'i1', status: 0, title: 'first item', sortOrder: 1 },
          ],
        }),
        task('r1', 'p3', {
          title: 'Weekly wash',
          startDate: '2026-11-16T00:00:00+0100',
          repeatFlag: 'RRULE:FREQ=WEEKLY;INTERVAL=1;BYDAY=MO',
          repeatFrom: '1',
        }),
        task('r2', 'p3', {
          title: 'Monthly check',
          startDate: '2026-11-16T00:00:00+0100',
          repeatFlag: 'RRULE:FREQ=MONTHLY;INTERVAL=1',
          repeatFrom: '0',
        }),
        task('r3', 'p3', {
          title: 'Odd repeat',
          startDate: '2026-11-16T00:00:00+0100',
          repeatFlag: 'RRULE:FREQ=DAILY;INTERVAL=2',
          repeatFrom: '7',
        }),
        task('d1', 'p3', {
          title: 'Done already',
          status: 2,
          completedTime: '2026-11-01T10:00:00+0000',
          isAllDay: false,
          startDate: '2026-10-30T09:00:00+0100',
        }),
      ],
    },
    { project: { id: 'p2', name: '👮🏻‍♂Zonnebloem', groupId: 'g1' }, tasks: [task('z1', 'p2')] },
    {
      project: { id: 'p4', name: '🧺  Thuis   algemeen', groupId: 'g2' },
      tasks: [task('h1', 'p4', { tags: ['waiting'] })],
    },
    { project: { id: 'p7', name: 'Leeg project', groupId: 'g2' }, tasks: [] },
    { project: { id: 'p5', name: '💭 Someday', groupId: null }, tasks: [task('s1', 'p5')] },
    { project: { id: 'inbox1', name: 'Postvak', groupId: null }, tasks: [task('n1', 'inbox1')] },
    {
      project: { id: 'p6', name: 'Oud project', closed: true, groupId: 'g1' },
      columns: [{ id: 'col2' }],
      tasks: [task('o1', 'p6'), task('o2', 'p6')],
    },
  ],
}

const TODAY = '2026-11-09'
const plan = (dump: TickTickDump = DUMP) => {
  const { rows, options } = convertTickTickDump(dump)
  return planTickTickImport(rows, { today: TODAY, timezone: 'Europe/Amsterdam', ...options })
}
const result = plan()
const byId = (id: string) => {
  const t = result.tasks.find((t) => t.id === stableId(`task:${id}`))
  if (!t) throw new Error(`no task ${id}`)
  return t
}

describe('ticktick api import', () => {
  it('maps groups, lists, inbox and someday despite emoji and odd spacing', () => {
    expect(result.areas.map((a) => a.title)).toEqual(['🏡 Thuis', '💼 Acme'])
    expect(result.projects.map((p) => p.title)).toEqual([
      'Leeg project',
      'Wasstraat',
      '👮🏻‍♂Zonnebloem',
    ])
    const acme = result.areas.find((a) => a.title === '💼 Acme')
    const thuis = result.areas.find((a) => a.title === '🏡 Thuis')
    expect(byId('a1')).toMatchObject({ areaId: acme?.id, projectId: null })
    expect(byId('h1')).toMatchObject({ areaId: thuis?.id, projectId: null })
    expect(byId('c1').projectId).toBe(result.projects.find((p) => p.title === 'Wasstraat')?.id)
    expect(byId('n1').when).toEqual({ kind: 'inbox' })
    expect(byId('s1').when).toEqual({ kind: 'someday' })
  })

  it('skips closed lists and reports them', () => {
    expect(result.tasks.some((t) => t.title === 'Task o1')).toBe(false)
    expect(result.projects.some((p) => p.title === 'Oud project')).toBe(false)
    expect(result.skipped).toEqual({ closedLists: ['Oud project'], tasksInClosedLists: 2 })
  })

  it('uses tag labels and parents, and keeps unused tags', () => {
    const tags = Object.fromEntries(result.tags.map((t) => [t.title, t]))
    expect(Object.keys(tags).sort()).toEqual(['Jordy', 'Ongebruikt', 'Personen', 'Waiting'])
    expect(tags.Jordy?.parentId).toBe(tags.Personen?.id)
    expect(tags.Personen?.parentId).toBeNull()
    expect(tags.Waiting?.parentId).toBeNull()
    expect(byId('a1').tagIds).toEqual([tags.Jordy?.id])
    expect(tags.Jordy?.id).toBe(stableId('tag:jordy'))
  })

  it('builds the checklist from items with desc as notes', () => {
    const c1 = byId('c1')
    expect(c1.notes).toBe('Remember the invoice')
    const items = result.checklist.filter((c) => c.taskId === c1.id)
    expect(items.map((c) => [c.title, c.done])).toEqual([
      ['first item', false],
      ['done item', true],
    ])
  })

  it('maps repeatFrom to the repeat basis and warns about odd values', () => {
    const basis = (id: string) =>
      result.tasks.find((t) => t.id !== byId(id).id && t.repeat && t.title === byId(id).title)
        ?.repeat?.basis
    expect(basis('r1')).toBe('completion')
    expect(basis('r2')).toBe('schedule')
    expect(basis('r3')).toBe('schedule')
    expect(result.warnings.filter((w) => w.includes('Odd repeat'))).toHaveLength(1)
    expect(result.warnings.some((w) => w.includes('Weekly wash'))).toBe(false)
  })

  it('converts to the calendar date in the task timezone', () => {
    expect(byId('a1').when).toEqual({ kind: 'date', date: '2026-11-16' })
  })

  it('warns once about times of day and reminders, and about kanban columns', () => {
    const timeWarnings = result.warnings.filter((w) => w.includes('time of day'))
    expect(timeWarnings).toEqual([
      '2 open tasks had a time of day or reminders; Dingen has dates only, so those were dropped',
    ])
    expect(result.warnings.filter((w) => w.includes('kanban'))).toEqual([
      'List "Wasstraat": has kanban columns; the columns were ignored',
    ])
  })

  it('orders tasks by sortOrder within their list', () => {
    const acme = result.tasks.filter((t) => t.areaId === byId('a1').areaId && t.repeat === null)
    const sorted = [...acme].sort((a, b) => (a.order < b.order ? -1 : 1))
    expect(sorted.map((t) => t.title)).toEqual(['Early', 'Middle', 'Late'])
  })

  it('reports counts per area and project, including empty projects', () => {
    const text = describePlan(result)
    expect(text).toContain('💼 Acme: 9 (8 open, 1 done)')
    expect(text).toContain('    Wasstraat: 5 (4 open, 1 done)')
    expect(text).toContain('    Leeg project: 0 (0 open, 0 done)')
    expect(text).toContain('    Inbox: 1 (1 open, 0 done)')
  })

  it('is idempotent, also on a second apply', async () => {
    const again = plan()
    expect(again.tasks.map((t) => t.id)).toEqual(result.tasks.map((t) => t.id))
    expect(stableId('area:💼 Acme')).toBe(result.areas[1]?.id)
    expect(stableId('project:Wasstraat')).toBe(result.projects[1]?.id)

    const records = new Map<string, EntityRecord>()
    const log: Change[] = []
    const transport: SyncTransport = {
      snapshot: async () => ({ entities: [...records.values()], seq: log.length }),
      pull: async (since) => ({ changes: log.slice(since), seq: log.length, hasMore: false }),
      push: async (changes) => {
        for (const c of changes) {
          const key = recordKey(c.entityType, c.entityId)
          records.set(key, applyChange(records.get(key), c))
          log.push(c)
        }
        return { seq: log.length, applied: changes.length, duplicates: 0 }
      },
    }
    const apply = async () => {
      const client = new DingenClient(transport, { today: () => TODAY })
      await client.refresh()
      const res = importTickTick(client, plan())
      await client.flush()
      return res
    }
    const first = await apply()
    expect(first.created.task).toBe(result.tasks.length)
    expect(first.alreadyThere).toBe(0)
    const second = await apply()
    expect(second.alreadyThere).toBeGreaterThan(0)
    expect(Object.values(second.created).every((n) => n === 0)).toBe(true)
  })

  it('rejects a file that is not a dump', () => {
    expect(() => parseTickTickDump('{"tasks": []}')).toThrow(/Not a TickTick API dump/)
    expect(parseTickTickDump(JSON.stringify(DUMP)).lists).toHaveLength(DUMP.lists.length)
  })
})
