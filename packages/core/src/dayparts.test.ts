import { describe, expect, it } from 'vitest'
import { buildSnapshot, moveFields } from './actions.js'
import {
  daypartOf,
  daypartStartTime,
  downgradeTaskData,
  downgradeTaskFields,
  upgradeTaskFields,
} from './dayparts.js'
import { Task } from './entities.js'
import { newTask } from './factories.js'
import { LEGACY_PROTOCOL, requestProtocol, SYNC_PROTOCOL } from './protocol.js'

const DATE = { kind: 'date', date: '2026-11-20' } as const

describe('daypartOf', () => {
  it('uses fixed boundaries: afternoon from 12:00, evening from 18:00', () => {
    expect(daypartOf('00:00')).toBe('morning')
    expect(daypartOf('07:30')).toBe('morning')
    expect(daypartOf('11:59')).toBe('morning')
    expect(daypartOf('12:00')).toBe('afternoon')
    expect(daypartOf('17:59')).toBe('afternoon')
    expect(daypartOf('18:00')).toBe('evening')
    expect(daypartOf('23:59')).toBe('evening')
  })
})

describe('daypartStartTime', () => {
  it('is 09:00, 13:00 or 19:00, and 09:00 without a daypart', () => {
    expect(daypartStartTime('morning')).toBe('09:00')
    expect(daypartStartTime('afternoon')).toBe('13:00')
    expect(daypartStartTime('evening')).toBe('19:00')
    expect(daypartStartTime(null)).toBe('09:00')
  })
})

describe('upgradeTaskFields (protocol 2 → 3)', () => {
  const current = (fields: Partial<Task> = {}) =>
    ({ ...newTask({ title: 'Water the plants', when: DATE, ...fields }) }) as Record<
      string,
      unknown
    >

  it('leaves fields without evening or time alone', () => {
    const fields = { title: 'x' }
    expect(upgradeTaskFields(fields, current())).toBe(fields)
  })

  it('turns evening into the evening daypart, and back off', () => {
    expect(upgradeTaskFields({ evening: true }, current())).toEqual({ daypart: 'evening' })
    expect(upgradeTaskFields({ evening: false }, current({ daypart: 'evening' }))).toEqual({
      daypart: null,
    })
  })

  it('keeps a morning or afternoon when evening goes off', () => {
    expect(upgradeTaskFields({ evening: false }, current({ daypart: 'morning' }))).toEqual({})
  })

  it('turns a time into its daypart plus a reminder when there was none', () => {
    expect(upgradeTaskFields({ time: '14:30' }, current())).toEqual({
      daypart: 'afternoon',
      reminder: { daysBefore: 0, time: '14:30' },
    })
  })

  it('does not add a reminder when the task has one or the change sets one', () => {
    const reminder = { daysBefore: 1, time: '20:00' }
    expect(upgradeTaskFields({ time: '08:00' }, current({ reminder }))).toEqual({
      daypart: 'morning',
    })
    expect(upgradeTaskFields({ time: '08:00', reminder: null }, current())).toEqual({
      daypart: 'morning',
      reminder: null,
    })
  })

  it('lets evening win over the daypart of a time', () => {
    expect(upgradeTaskFields({ evening: true, time: '10:00' }, current())).toEqual({
      daypart: 'evening',
      reminder: { daysBefore: 0, time: '10:00' },
    })
  })

  it('converts a new task from an old client (all fields)', () => {
    const { daypart: _d, duration: _u, ...rest } = newTask({ title: 'New', when: DATE })
    const old = { ...rest, evening: true, time: '19:30' }
    const fields = upgradeTaskFields(old, undefined)
    expect(fields).not.toHaveProperty('evening')
    expect(fields).not.toHaveProperty('time')
    expect(Task.strict().safeParse(fields).success).toBe(true)
    expect(fields).toMatchObject({ daypart: 'evening', reminder: null })
  })

  it('a new task without a date gets no daypart and no reminder', () => {
    const fields = upgradeTaskFields(
      { title: 'x', when: { kind: 'inbox' }, evening: false, time: null, reminder: null },
      undefined,
    )
    expect(fields).toEqual({ title: 'x', when: { kind: 'inbox' }, reminder: null })
  })

  it('clears the daypart when an old client moves the task off its date', () => {
    expect(
      upgradeTaskFields(
        { when: { kind: 'someday' }, evening: false },
        current({ daypart: 'morning' }),
      ),
    ).toEqual({ when: { kind: 'someday' }, daypart: null })
  })

  it('leaves a malformed evening or time in, so validation rejects it', () => {
    expect(upgradeTaskFields({ time: '25:00' }, current())).toEqual({ time: '25:00' })
    expect(upgradeTaskFields({ evening: 'yes' }, current())).toEqual({ evening: 'yes' })
  })
})

describe('downgrade for protocol 2 clients', () => {
  it('derives evening and sets time to null on data', () => {
    const task = { ...newTask({ title: 'x', when: DATE, daypart: 'evening', duration: 15 }) }
    expect(downgradeTaskData(task)).toMatchObject({ evening: true, time: null, duration: 15 })
    expect(downgradeTaskData({ ...task, daypart: 'morning' })).toMatchObject({ evening: false })
  })

  it('adds evening to a change of the daypart only', () => {
    expect(downgradeTaskFields({ daypart: 'evening' })).toEqual({
      daypart: 'evening',
      evening: true,
      time: null,
    })
    const other = { title: 'y' }
    expect(downgradeTaskFields(other)).toBe(other)
  })
})

describe('moveFields with a daypart', () => {
  const ws = (tasks: Task[]) =>
    buildSnapshot('2026-11-20', {
      tasks,
      projects: [],
      areas: [],
      headings: [],
      tags: [],
      checklist: [],
    })

  it('sets the daypart given, keeps it when none is given, and clears it without a date', () => {
    const task = newTask({ title: 'x', when: DATE, daypart: 'morning' })
    expect(moveFields(ws([task]), task, { kind: 'when', when: DATE, daypart: 'evening' })).toEqual({
      when: DATE,
      daypart: 'evening',
    })
    expect(moveFields(ws([task]), task, { kind: 'when', when: DATE })).toEqual({})
    const other = { kind: 'date', date: '2026-11-21' } as const
    expect(moveFields(ws([task]), task, { kind: 'when', when: other })).toEqual({
      when: other,
      daypart: 'morning',
    })
    expect(
      moveFields(ws([task]), task, { kind: 'when', when: { kind: 'anytime' }, daypart: 'evening' }),
    ).toEqual({ when: { kind: 'anytime' }, daypart: null })
  })
})

describe('protocol', () => {
  it('is 3, and a request without the header speaks protocol 2', () => {
    expect(SYNC_PROTOCOL).toBe(3)
    expect(requestProtocol(undefined)).toBe(LEGACY_PROTOCOL)
    expect(requestProtocol('nonsense')).toBe(2)
    expect(requestProtocol('3')).toBe(3)
  })
})
