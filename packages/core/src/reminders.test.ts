import { describe, expect, it } from 'vitest'
import { buildSnapshot, commitTask, setRepeat, toggleTask, type Writer } from './actions.js'
import { type Entity, type EntityType, Task, validateChangeFields } from './entities.js'
import { newTask } from './factories.js'
import { createClock } from './hlc.js'
import { ulid } from './ids.js'
import { reminderFields, reminderMoment } from './reminders.js'

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

describe('daypart, duration and reminder fields', () => {
  it('parse a task synced before they existed, with nulls', () => {
    const { daypart: _d, duration: _u, reminder: _r, ...old } = dated()
    const parsed = Task.parse(old)
    expect(parsed.daypart).toBeNull()
    expect(parsed.duration).toBeNull()
    expect(parsed.reminder).toBeNull()
  })

  it('pass server-side validation for a new task without them (old clients)', () => {
    const { id, daypart: _d, duration: _u, reminder: _r, ...fields } = dated()
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
    expect(check({ reminder: { daysBefore: 0, time: '24:00' } })).toBe(false)
    expect(check({ daypart: 'morning', reminder: { daysBefore: 1, time: '20:00' } })).toBe(true)
    expect(check({ daypart: 'night' })).toBe(false)
    expect(check({ duration: 15 })).toBe(true)
    expect(check({ duration: 1440 })).toBe(true)
    expect(check({ duration: 0 })).toBe(false)
    expect(check({ duration: 1441 })).toBe(false)
    expect(check({ duration: 7.5 })).toBe(false)
    // The fields of protocol 2 are gone.
    expect(check({ time: '09:30' })).toBe(false)
    expect(check({ evening: true })).toBe(false)
    expect(check({ reminder: { daysBefore: -1, time: '09:00' } })).toBe(false)
    expect(check({ reminder: { time: '09:00' } })).toBe(false)
  })

  it('validate a change against data stored before protocol 3 (with evening and time)', () => {
    const task = dated()
    const change = {
      id: ulid(),
      entityType: 'task' as const,
      entityId: task.id,
      fields: { title: 'Call the plumber again' },
      ts: createClock('A', () => 1000).now(),
      clientId: 'c',
    }
    expect(validateChangeFields(change, { ...task, evening: true, time: '10:00' }).ok).toBe(true)
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

describe('reminderFields', () => {
  it('sets, changes and removes a reminder', () => {
    const reminder = { daysBefore: 0, time: '14:30' }
    expect(reminderFields(dated(), reminder)).toEqual({ reminder })
    expect(reminderFields(dated({ reminder }), { daysBefore: 1, time: '14:30' })).toEqual({
      reminder: { daysBefore: 1, time: '14:30' },
    })
    expect(reminderFields(dated({ reminder }), null)).toEqual({ reminder: null })
  })

  it('is empty when nothing changes or without a date', () => {
    const reminder = { daysBefore: 0, time: '14:30' }
    expect(reminderFields(dated({ reminder }), { ...reminder })).toEqual({})
    expect(reminderFields(dated({ when: { kind: 'inbox' } }), reminder)).toEqual({})
  })

  it('does not follow the daypart', () => {
    const reminder = { daysBefore: 0, time: '14:30' }
    const task = dated({ daypart: 'afternoon', reminder })
    const m = memory([task])
    commitTask(m.w, m.snapshot(), task, { daypart: 'evening' })
    expect(m.byId.get(task.id)?.reminder).toEqual(reminder)
  })
})

describe('with the actions', () => {
  it('moving to a list without a date clears daypart and reminder', () => {
    const task = dated({ daypart: 'morning', reminder: { daysBefore: 0, time: '09:00' } })
    const m = memory([task])
    commitTask(m.w, m.snapshot(), task, { when: { kind: 'someday' } })
    const after = m.byId.get(task.id)
    expect(after?.daypart).toBeNull()
    expect(after?.reminder).toBeNull()
  })

  it('moving to another date keeps them', () => {
    const task = dated({ daypart: 'morning', reminder: { daysBefore: 0, time: '09:00' } })
    const m = memory([task])
    commitTask(m.w, m.snapshot(), task, { when: { kind: 'date', date: '2026-11-20' } })
    expect(m.byId.get(task.id)?.daypart).toBe('morning')
    expect(m.byId.get(task.id)?.reminder).toEqual({ daysBefore: 0, time: '09:00' })
  })

  it('a repeating task takes daypart, duration and reminder to the next occurrence', () => {
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
    // Setting them on the instance mirrors them to the template.
    const instance = m.byId.get(task.id) as Task
    commitTask(m.w, m.snapshot(), instance, {
      daypart: 'morning',
      duration: 45,
      ...reminderFields(instance, { daysBefore: 0, time: '07:45' }),
    })
    toggleTask(m.w, m.snapshot(), m.byId.get(task.id) as Task)
    const next = [...m.byId.values()].find(
      (t) => t.templateId !== null && t.id !== task.id && t.status === 'open',
    )
    expect(next?.when).toEqual({ kind: 'date', date: '2026-11-12' })
    expect(next?.daypart).toBe('morning')
    expect(next?.duration).toBe(45)
    expect(next?.reminder).toEqual({ daysBefore: 0, time: '07:45' })
  })

  it('moving an occurrence to Anytime does not clear the daypart of later ones', () => {
    const task = dated({ daypart: 'evening' })
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
    expect(template?.daypart).toBe('evening')
    expect(m.byId.get(task.id)?.daypart).toBeNull()
  })
})
