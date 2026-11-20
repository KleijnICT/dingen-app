import { newProject, newTask, orderBetween, type Task } from '@dingen/core'
import type { DragEndEvent } from '@dnd-kit/core'
import { describe, expect, it } from 'vitest'
import { blockIndex, type DragData, type DropData, draggedTasks, handleDragEnd } from './dnd.js'

const a0 = orderBetween(null, null)
const a1 = orderBetween(a0, null)
const a2 = orderBetween(a1, null)
const a3 = orderBetween(a2, null)
const a4 = orderBetween(a3, null)

describe('draggedTasks', () => {
  const one = newTask({ title: 'One' })
  const two = newTask({ title: 'Two' })
  const done = newTask({ title: 'Done', status: 'completed' })

  it('is just the task without a selection', () => {
    expect(draggedTasks(one, undefined)).toEqual([one])
  })

  it('is just the task when it is not part of the selection', () => {
    expect(draggedTasks(one, [two, done])).toEqual([one])
  })

  it('is the whole selection, in its order, when the task is part of it', () => {
    expect(draggedTasks(two, [one, two])).toEqual([one, two])
  })

  it('leaves finished tasks out, unless it is the one dragged', () => {
    expect(draggedTasks(one, [one, done, two])).toEqual([one, two])
    expect(draggedTasks(done, [one, done])).toEqual([one, done])
  })
})

describe('blockIndex', () => {
  const rows = ['a', 'b', 'c', 'd', 'e'].map((id) => ({ id }))

  it('is the plain index for a single task, like a one-row drag', () => {
    expect(blockIndex(rows, 'c', new Set(['a']), false)).toBe(1)
    expect(blockIndex(rows, 'c', new Set(['a']), true)).toBe(2)
  })

  it('counts only the rows that stay', () => {
    expect(blockIndex(rows, 'e', new Set(['a', 'c']), false)).toBe(2)
    expect(blockIndex(rows, 'e', new Set(['a', 'c']), true)).toBe(3)
  })

  it('works when dropped on another selected row', () => {
    expect(blockIndex(rows, 'c', new Set(['b', 'c']), false)).toBe(1)
    expect(blockIndex(rows, 'c', new Set(['b', 'c']), true)).toBe(1)
  })

  it('is null for a row that is not in the group', () => {
    expect(blockIndex(rows, 'x', new Set(['a']), false)).toBeNull()
  })
})

describe('handleDragEnd with a selection', () => {
  const project = newProject({ title: 'Target', order: a0 })
  const existing = newTask({ title: 'Existing', projectId: project.id, order: a0 })
  const area = 'area-1'
  const t1 = newTask({ title: 'T1', areaId: area, when: { kind: 'anytime' }, order: a1 })
  const t2 = newTask({ title: 'T2', areaId: area, when: { kind: 'anytime' }, order: a2 })
  const t3 = newTask({ title: 'T3', areaId: area, when: { kind: 'anytime' }, order: a3 })
  const t4 = newTask({ title: 'T4', areaId: area, when: { kind: 'anytime' }, order: a4 })
  const areaRows = [t1, t2, t3, t4]
  const areaGroup = { key: `area:${area}`, target: { kind: 'area', areaId: area } } as const
  const ws = {
    today: '2026-11-20',
    tasks: [existing, ...areaRows],
    projects: [project],
    templateById: new Map(),
  } as never

  function drop(active: DragData, over: DropData, overId: string, below = false) {
    const changes = new Map<string, Record<string, unknown>>()
    const engine = {
      mutate: (_type: string, id: string, fields: Record<string, unknown>) =>
        changes.set(id, { ...changes.get(id), ...fields }),
    } as never
    const rect = { top: below ? 100 : 0, height: 10 }
    const event = {
      active: {
        id: active.type === 'task' ? active.task.id : 'x',
        data: { current: active },
        rect: { current: { translated: rect } },
      },
      over: { id: overId, data: { current: over }, rect: { top: 50, height: 10 } },
    } as unknown as DragEndEvent
    handleDragEnd(engine, ws, event)
    return changes
  }

  const dragOf = (task: Task, selection?: Task[]): DragData => ({
    type: 'task',
    task,
    group: areaGroup,
    siblings: areaRows,
    selection,
  })

  it('moves every selected task onto a project, keeping their order', () => {
    const changes = drop(dragOf(t3, [t1, t3]), { type: 'project', project }, 'p')
    expect([...changes.keys()]).toEqual([t1.id, t3.id])
    const o1 = changes.get(t1.id)?.order as string
    const o3 = changes.get(t3.id)?.order as string
    expect(changes.get(t1.id)).toMatchObject({ projectId: project.id, areaId: null })
    expect(changes.get(t3.id)).toMatchObject({ projectId: project.id, areaId: null })
    expect(a0 < o1 && o1 < o3).toBe(true)
  })

  it('moves only the dragged task when it is not selected', () => {
    const changes = drop(dragOf(t2, undefined), { type: 'project', project }, 'p')
    expect([...changes.keys()]).toEqual([t2.id])
  })

  it('plans every selected task for today from the sidebar', () => {
    const changes = drop(dragOf(t1, [t1, t2, t4]), { type: 'list', listId: 'today' }, 'today')
    expect([...changes.keys()]).toEqual([t1.id, t2.id, t4.id])
    for (const fields of changes.values()) {
      expect(fields.when).toEqual({ kind: 'date', date: '2026-11-20' })
    }
  })

  it('lands a selected block together where it is dropped, in its order', () => {
    // T1 and T3 dropped below T4: T2, T4, T1, T3.
    const over: DropData = { type: 'task', task: t4, group: areaGroup, siblings: areaRows }
    const changes = drop(dragOf(t1, [t1, t3]), over, t4.id, true)
    expect([...changes.keys()]).toEqual([t1.id, t3.id])
    const o1 = changes.get(t1.id)?.order as string
    const o3 = changes.get(t3.id)?.order as string
    expect(a4 < o1 && o1 < o3).toBe(true)
    // Already in the area: only the order changes.
    expect(Object.keys(changes.get(t1.id) ?? {})).toEqual(['order'])
  })

  it('lands a block between two rows', () => {
    // T3 and T4 dropped above T2: T1, T3, T4, T2.
    const over: DropData = { type: 'task', task: t2, group: areaGroup, siblings: areaRows }
    const changes = drop(dragOf(t4, [t3, t4]), over, t2.id, false)
    const o3 = changes.get(t3.id)?.order as string
    const o4 = changes.get(t4.id)?.order as string
    expect(a1 < o3 && o3 < o4 && o4 < a2).toBe(true)
  })

  it('gives tasks from elsewhere what the group means (a heading)', () => {
    const headingGroup = {
      key: `project:${project.id}:h1`,
      target: { kind: 'project', projectId: project.id, headingId: 'h1' },
    } as const
    const over: DropData = { type: 'group', group: headingGroup, siblings: [] }
    const changes = drop(dragOf(t2, [t2, t3]), over, 'group')
    expect(changes.get(t2.id)).toMatchObject({ projectId: project.id, headingId: 'h1' })
    expect(changes.get(t3.id)).toMatchObject({ projectId: project.id, headingId: 'h1' })
    const o2 = changes.get(t2.id)?.order as string
    const o3 = changes.get(t3.id)?.order as string
    expect(o2 < o3).toBe(true)
  })
})
