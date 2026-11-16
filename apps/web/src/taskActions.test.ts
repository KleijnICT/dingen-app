import { newTask, orderBetween } from '@dingen/core'
import { describe, expect, it } from 'vitest'
import { newInboxTask } from './taskActions.js'

describe('newInboxTask', () => {
  const a0 = orderBetween(null, null)
  const a1 = orderBetween(a0, null)
  const a2 = orderBetween(a1, null)
  const first = newTask({ title: 'First', order: a0 })
  const second = newTask({ title: 'Second', order: a1 })
  const today = newTask({ title: 'Today', when: { kind: 'date', date: '2026-11-16' }, order: a2 })
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
