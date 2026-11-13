import { describe, expect, it } from 'vitest'
import { buildSnapshot, duplicateOf, duplicateTask, type Writer } from './actions.js'
import type { Entity, EntityType, Task } from './entities.js'
import { newChecklistItem, newTask } from './factories.js'
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
    evening: true,
    time: '09:30',
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
      evening: true,
      time: '09:30',
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
