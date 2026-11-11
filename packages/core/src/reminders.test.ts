import { describe, expect, it } from 'vitest'
import { buildSnapshot, commitTask, setRepeat, toggleTask, type Writer } from './actions.js'
import { type Entity, type EntityType, Task, validateChangeFields } from './entities.js'
import { newTask } from './factories.js'
import { createClock } from './hlc.js'
import { ulid } from './ids.js'
import { reminderMoment, scheduleFields } from './reminders.js'

const TODAY = '2026-11-11'

/** A writer that keeps the tasks in memory, like the web engine would. */
function memory(tasks: Task[]) {
  const byId = new Map(tasks.map((t) => [t.id, t]))
  const mutations: { id: string; fields: Record<string, unknown> }[] = []
  const w: Writer = {
    create(type: EntityType, entity: Entity) {
      if (type === 'task') byId.set(entity.id, entity as Task)
    },
    mutate(type: EntityType, id: string, fields: Record<string, unknown>) {
      if (type !== 'task') return
      mutations.push({ id, fields })
      const current = byId.get(id)
      if (current) byId.set(id, { ...current, ...fields } as Task)
    },
  }
  const snapshot = () =>
    buildSnapshot(TODAY, {
      tasks: [...byId.values()].filter((t) => !t.deleted),
      projects: [],
      areas: [],
      headings: [],
      tags: [],
      checklist: [],
    })
  return { w, byId, mutations, snapshot }
}

const dated = (fields: Partial<Task> = {}) =>
  newTask({ title: 'Call the plumber', when: { kind: 'date', date: '2026-11-12' }, ...fields })

describe('time and reminder fields', () => {
  it('parse a task synced before they existed, with nulls', () => {
    const { time: _t, reminder: _r, ...old } = dated()
    const parsed = Task.parse(old)
    expect(parsed.time).toBeNull()
    expect(parsed.reminder).toBeNull()
  })

  it('pass server-side validation for a new task without them (old clients)', () => {
    const { id, time: _t, reminder: _r, ...fields } = dated()
    const change = {
      id: ulid(),
      entityType: 'task' as const,
      entityId: id,
      fields,
      ts: createClock('A', () => 1000).now(),
      clientId: 'c',
    }
    expect(validateChangeFields(change, undefined).ok).toBe(true)
  })

  it('validate the shapes', () => {
    const task = dated()
    const check = (fields: Record<string, unknown>) =>
      validateChangeFields(
        {
          id: ulid(),
          entityType: 'task',
          entityId: task.id,
          fields,
          ts: createClock('A', () => 1000).now(),
          clientId: 'c',
        },
        { ...task },
      ).ok
    expect(check({ time: '09:30', reminder: { daysBefore: 1, time: '20:00' } })).toBe(true)
    expect(check({ time: '24:00' })).toBe(false)
    expect(check({ time: '9:30' })).toBe(false)
    expect(check({ reminder: { daysBefore: -1, time: '09:00' } })).toBe(false)
    expect(check({ reminder: { time: '09:00' } })).toBe(false)
  })
})

describe('reminderMoment', () => {
  it('is the date minus daysBefore at the reminder time', () => {
    expect(reminderMoment(dated({ reminder: { daysBefore: 0, time: '09:00' } }))).toEqual({
      date: '2026-11-12',
      time: '09:00',
    })
    expect(reminderMoment(dated({ reminder: { daysBefore: 2, time: '18:15' } }))).toEqual({
      date: '2026-11-10',
      time: '18:15',
    })
  })

  it('is null without a date, when done, deleted or for a template', () => {
    const reminder = { daysBefore: 0, time: '09:00' }
    expect(reminderMoment(dated())).toBeNull()
    expect(reminderMoment(dated({ reminder, when: { kind: 'anytime' } }))).toBeNull()
    expect(reminderMoment(dated({ reminder, status: 'completed' }))).toBeNull()
    expect(reminderMoment(dated({ reminder, deleted: true }))).toBeNull()
    const rule = {
      unit: 'day' as const,
      every: 1,
      basis: 'schedule' as const,
      weekdays: [],
      start: TODAY,
      until: null,
      deadlineDays: null,
    }
    expect(reminderMoment(dated({ reminder, repeat: rule }))).toBeNull()
  })
})

describe('scheduleFields', () => {
  it('sets a reminder at a new time when there was none', () => {
    expect(scheduleFields(dated(), { time: '14:30' })).toEqual({
      time: '14:30',
      reminder: { daysBefore: 0, time: '14:30' },
    })
  })

  it('moves a reminder that followed the old time, and removes it with the time', () => {
    const task = dated({ time: '14:30', reminder: { daysBefore: 0, time: '14:30' } })
    expect(scheduleFields(task, { time: '15:00' })).toEqual({
      time: '15:00',
      reminder: { daysBefore: 0, time: '15:00' },
    })
    expect(scheduleFields(task, { time: null })).toEqual({ time: null, reminder: null })
  })

  it('leaves a reminder that was set apart', () => {
    const task = dated({ time: '14:30', reminder: { daysBefore: 1, time: '20:00' } })
    expect(scheduleFields(task, { time: '15:00' })).toEqual({ time: '15:00' })
    expect(scheduleFields(task, { time: null })).toEqual({ time: null })
  })

  it('does not add a reminder when the time had none on purpose', () => {
    expect(scheduleFields(dated({ time: '14:30' }), { time: '15:00' })).toEqual({ time: '15:00' })
  })

  it('takes an explicit reminder, also null', () => {
    const task = dated({ time: '14:30', reminder: { daysBefore: 0, time: '14:30' } })
    expect(scheduleFields(task, { time: '16:00', reminder: null })).toEqual({
      time: '16:00',
      reminder: null,
    })
    expect(scheduleFields(task, { reminder: { daysBefore: 0, time: '14:30' } })).toEqual({})
  })

  it('does nothing without a date', () => {
    expect(scheduleFields(dated({ when: { kind: 'inbox' } }), { time: '10:00' })).toEqual({})
  })
})

describe('with the actions', () => {
  it('moving to a list without a date clears time and reminder', () => {
    const task = dated({ time: '09:00', reminder: { daysBefore: 0, time: '09:00' } })
    const m = memory([task])
    commitTask(m.w, m.snapshot(), task, { when: { kind: 'someday' } })
    const after = m.byId.get(task.id)
    expect(after?.time).toBeNull()
    expect(after?.reminder).toBeNull()
  })

  it('moving to another date keeps them', () => {
    const task = dated({ time: '09:00', reminder: { daysBefore: 0, time: '09:00' } })
    const m = memory([task])
    commitTask(m.w, m.snapshot(), task, { when: { kind: 'date', date: '2026-11-20' } })
    expect(m.byId.get(task.id)?.time).toBe('09:00')
  })

  it('a repeating task takes time and reminder to the next occurrence', () => {
    const task = dated({ when: { kind: 'date', date: TODAY } })
    const m = memory([task])
    setRepeat(m.w, m.snapshot(), task, {
      unit: 'day',
      every: 1,
      basis: 'schedule',
      weekdays: [],
      start: TODAY,
      until: null,
      deadlineDays: null,
    })
    // Setting the time on the instance mirrors it to the template.
    const instance = m.byId.get(task.id) as Task
    commitTask(m.w, m.snapshot(), instance, scheduleFields(instance, { time: '07:45' }))
    toggleTask(m.w, m.snapshot(), m.byId.get(task.id) as Task)
    const next = [...m.byId.values()].find(
      (t) => t.templateId !== null && t.id !== task.id && t.status === 'open',
    )
    expect(next?.when).toEqual({ kind: 'date', date: '2026-11-12' })
    expect(next?.time).toBe('07:45')
    expect(next?.reminder).toEqual({ daysBefore: 0, time: '07:45' })
  })

  it('moving an occurrence to Anytime does not clear the time of later ones', () => {
    const task = dated({ time: '07:45' })
    const m = memory([task])
    setRepeat(m.w, m.snapshot(), task, {
      unit: 'week',
      every: 1,
      basis: 'schedule',
      weekdays: [],
      start: TODAY,
      until: null,
      deadlineDays: null,
    })
    const instance = m.byId.get(task.id) as Task
    commitTask(m.w, m.snapshot(), instance, { when: { kind: 'anytime' } })
    const template = m.byId.get(instance.templateId as string)
    expect(template?.time).toBe('07:45')
    expect(m.byId.get(task.id)?.time).toBeNull()
  })
})
