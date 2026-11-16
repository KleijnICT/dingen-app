import { describe, expect, it } from 'vitest'
import {
  buildSnapshot,
  convertTaskToProject,
  duplicateOf,
  duplicateTask,
  type Writer,
} from './actions.js'
import { type Entity, type EntityType, Project, Task } from './entities.js'
import { newChecklistItem, newProject, newTask } from './factories.js'
import { ulid } from './ids.js'
import { compareOrder, orderBetween } from './order.js'
import * as views from './views.js'

const today = '2026-11-13'

function snapshot(tasks: Task[], checklist = [] as ReturnType<typeof newChecklistItem>[]) {
  return buildSnapshot(today, {
    tasks,
    projects: [],
    areas: [],
    headings: [],
    tags: [],
    checklist,
  })
}

describe('duplicate', () => {
  const a = orderBetween(null, null)
  const c = orderBetween(a, null)
  const original = newTask({
    title: 'Plan trip',
    notes: 'Book the train',
    when: { kind: 'date', date: today },
    daypart: 'evening',
    duration: 30,
    reminder: { daysBefore: 0, time: '09:30' },
    deadline: '2026-11-20',
    tagIds: ['tag1'],
    projectId: 'p1',
    headingId: 'h1',
    status: 'completed',
    completedAt: '2026-11-13T08:00:00.000Z',
    templateId: 'tpl',
    assigneeId: 'agent:x',
    order: a,
  })
  const next = newTask({ title: 'Next', order: c })

  it('copies the content and place, but not completion, repetition or assignee', () => {
    const { task } = duplicateOf(snapshot([original, next]), original)
    expect(task.id).not.toBe(original.id)
    expect(task).toMatchObject({
      title: 'Plan trip',
      notes: 'Book the train',
      when: { kind: 'date', date: today },
      daypart: 'evening',
      duration: 30,
      reminder: { daysBefore: 0, time: '09:30' },
      deadline: '2026-11-20',
      tagIds: ['tag1'],
      projectId: 'p1',
      headingId: 'h1',
      status: 'open',
      completedAt: null,
      templateId: null,
      repeat: null,
      assigneeId: null,
      deleted: false,
    })
    expect(task.tagIds).not.toBe(original.tagIds)
  })

  it('sorts right below the original', () => {
    const { task } = duplicateOf(snapshot([next, original]), original)
    const sorted = [original, next, task].sort(views.byOrder).map((t) => t.title)
    expect(sorted).toEqual(['Plan trip', 'Plan trip', 'Next'])
    expect(compareOrder(task.order, original.order)).toBe(1)
    expect(compareOrder(task.order, next.order)).toBe(-1)
    // The last task in the list: the copy goes after it.
    expect(duplicateOf(snapshot([original]), original).task.order > original.order).toBe(true)
  })

  it('keeps its place in Today when the original has one', () => {
    const t1 = orderBetween(null, null)
    const t2 = orderBetween(t1, null)
    const first = { ...original, todayOrder: t1 }
    const second = newTask({ title: 'Second', order: orderBetween(null, a), todayOrder: t2 })
    const { task } = duplicateOf(snapshot([first, second]), first)
    const ids = [second, first, task].sort(views.byTodayOrder).map((t) => t.id)
    expect(ids).toEqual([first.id, task.id, second.id])
    expect(duplicateOf(snapshot([original]), original).task.todayOrder).toBeNull()
  })

  it('copies the checklist with every item open', () => {
    const items = [
      newChecklistItem({ title: 'Tickets', taskId: original.id, done: true, order: a }),
      newChecklistItem({ title: 'Hotel', taskId: original.id, order: c }),
    ]
    const written: [EntityType, Entity][] = []
    const w: Writer = {
      create: (type, entity) => written.push([type, entity]),
      mutate: () => {},
    }
    const copy = duplicateTask(w, snapshot([original], items), original)
    expect(written.map(([type]) => type)).toEqual(['task', 'checklistItem', 'checklistItem'])
    const copied = written.slice(1).map(([, e]) => e) as typeof items
    expect(copied.map((i) => [i.title, i.done, i.taskId])).toEqual([
      ['Tickets', false, copy.id],
      ['Hotel', false, copy.id],
    ])
    expect(copied[0]?.id).not.toBe(items[0]?.id)
  })
})

describe('convert a task to a project', () => {
  const a = orderBetween(null, null)
  const b = orderBetween(a, null)
  const c = orderBetween(b, null)
  const AREA = ulid()
  const OTHER_AREA = ulid()
  const TAGS = [ulid(), ulid()]
  const project = newProject({ title: 'Home', areaId: AREA, order: a })
  const task = newTask({
    title: 'Move house',
    notes: 'Before spring',
    projectId: project.id,
    when: { kind: 'date', date: today },
    daypart: 'morning',
    duration: 45,
    reminder: { daysBefore: 0, time: '08:00' },
    deadline: '2026-12-01',
    tagIds: TAGS,
    assigneeId: 'agent:x',
  })
  const items = [
    newChecklistItem({ title: 'Boxes', taskId: task.id, done: true, order: a }),
    newChecklistItem({ title: 'Movers', taskId: task.id, order: b }),
    newChecklistItem({ title: 'New address', taskId: task.id, order: c }),
  ] as const
  // Out of order on purpose: the snapshot sorts the checklist.
  const ws = buildSnapshot(today, {
    tasks: [task],
    projects: [project],
    areas: [],
    headings: [],
    tags: [],
    checklist: [items[2], items[0], items[1]],
  })

  function convert(snap = ws, t = task) {
    const created: [EntityType, Entity][] = []
    const mutated: [EntityType, string, Record<string, unknown>][] = []
    const w: Writer = {
      create: (type, entity) => created.push([type, entity]),
      mutate: (type, id, fields) => mutated.push([type, id, fields]),
    }
    const result = convertTaskToProject(w, snap, t)
    return { result, created, mutated }
  }

  it("takes the task's content and the area of its project, not what only tasks have", () => {
    const { result, created } = convert()
    expect(created[0]).toEqual(['project', result])
    expect(result).toMatchObject({
      title: 'Move house',
      notes: 'Before spring',
      areaId: AREA,
      status: 'open',
      when: { kind: 'date', date: today },
      deadline: '2026-12-01',
      tagIds: TAGS,
    })
    expect(result.tagIds).not.toBe(task.tagIds)
    expect(Object.keys(result)).not.toContain('daypart')
    // Below the other projects in the area.
    expect(compareOrder(result.order, project.order)).toBe(1)
  })

  it('turns the checklist into tasks in order, ticked items completed', () => {
    const { result, created } = convert()
    expect(created.slice(1).map(([type]) => type)).toEqual(['task', 'task', 'task'])
    const tasks = created.slice(1).map(([, e]) => e as Task)
    expect([...tasks].sort(views.byOrder).map((t) => [t.title, t.status])).toEqual([
      ['Boxes', 'completed'],
      ['Movers', 'open'],
      ['New address', 'open'],
    ])
    for (const t of tasks) {
      expect(t).toMatchObject({ projectId: result.id, areaId: null, when: { kind: 'anytime' } })
      expect(t.completedAt === null).toBe(t.status === 'open')
      expect(Task.safeParse(t).success).toBe(true)
    }
    expect(Project.safeParse(result).success).toBe(true)
  })

  it('deletes the original task', () => {
    const { mutated } = convert()
    expect(mutated).toEqual([['task', task.id, { deleted: true }]])
  })

  it('makes an Inbox task an Anytime project without an area', () => {
    const inboxTask = newTask({ title: 'Plan party' })
    const { result, created } = convert(snapshot([inboxTask]), inboxTask)
    expect(result).toMatchObject({ when: { kind: 'anytime' }, areaId: null, deadline: null })
    expect(created).toHaveLength(1)
  })

  it("keeps a loose task's area and someday", () => {
    const loose = newTask({ title: 'Learn piano', areaId: OTHER_AREA, when: { kind: 'someday' } })
    const { result } = convert(snapshot([loose]), loose)
    expect(result).toMatchObject({ areaId: OTHER_AREA, when: { kind: 'someday' } })
  })

  it('refuses the template of a repeating task', () => {
    const template = newTask({
      title: 'Weekly',
      repeat: {
        unit: 'week',
        every: 1,
        basis: 'schedule',
        weekdays: [],
        start: today,
        until: null,
        deadlineDays: null,
      },
    })
    expect(() => convert(snapshot([template]), template)).toThrow()
  })
})
