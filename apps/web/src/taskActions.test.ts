import { newTask, orderBetween } from '@dingen/core'
import { describe, expect, it } from 'vitest'
import { createListTask, newInboxTask } from './taskActions.js'

describe('newInboxTask', () => {
  const a0 = orderBetween(null, null)
  const a1 = orderBetween(a0, null)
  const a2 = orderBetween(a1, null)
  const first = newTask({ title: 'First', order: a0 })
  const second = newTask({ title: 'Second', order: a1 })
  const today = newTask({
    title: 'Today',
    when: { kind: 'date', date: '2026-11-16' },
    areaId: 'area-1',
    order: a2,
  })
  const doneInInbox = newTask({ title: 'Done', status: 'completed', order: a2 })

  it('makes an empty task in the Inbox', () => {
    const task = newInboxTask({ tasks: [] })
    expect(task.title).toBe('')
    expect(task.when).toEqual({ kind: 'inbox' })
    expect(task.projectId).toBeNull()
    expect(task.areaId).toBeNull()
    expect(task.tagIds).toEqual([])
  })

  it('puts it after the last open task in the Inbox, whatever else there is', () => {
    const task = newInboxTask({ tasks: [today, second, doneInInbox, first] })
    expect(task.order).toBe(orderBetween(a1, null))
  })

  it('carries the tag of the active tag filter', () => {
    expect(newInboxTask({ tasks: [] }, 'tag-1').tagIds).toEqual(['tag-1'])
    expect(newInboxTask({ tasks: [] }, null).tagIds).toEqual([])
  })
})

describe('createListTask', () => {
  const a0 = orderBetween(null, null)
  const a1 = orderBetween(a0, null)
  const a2 = orderBetween(a1, null)
  const loose = newTask({ title: 'Loose', projectId: 'p1', order: a0 })
  const underHeading = newTask({ title: 'Heading', projectId: 'p1', headingId: 'h1', order: a2 })
  const done = newTask({ title: 'Done', projectId: 'p1', status: 'completed', order: a2 })
  const created: unknown[] = []
  const engine = { create: (_: string, task: unknown) => created.push(task) } as never

  it('makes a processed task in the project, after its last loose open task', () => {
    const task = createListTask(engine, { projectId: 'p1' }, [underHeading, loose, done], 'tag-1')
    expect(task.projectId).toBe('p1')
    expect(task.areaId).toBeNull()
    expect(task.headingId).toBeNull()
    expect(task.when).toEqual({ kind: 'anytime' })
    expect(task.tagIds).toEqual(['tag-1'])
    expect(task.order).toBe(orderBetween(a0, null))
    expect(created).toContain(task)
  })

  it('makes a task in an area', () => {
    const task = createListTask(engine, { areaId: 'a1' }, [])
    expect(task.areaId).toBe('a1')
    expect(task.projectId).toBeNull()
    expect(task.order).toBe(orderBetween(null, null))
  })
})
