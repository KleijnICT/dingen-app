import { describe, expect, it } from 'vitest'
import { addMonths, daysBetween } from './dates.js'
import type { Repeat } from './entities.js'
import { newTask } from './factories.js'
import { firstOccurrence, instanceOf, nextOccurrence } from './repeat.js'

const rule = (over: Partial<Repeat>): Repeat => ({
  unit: 'day',
  every: 1,
  basis: 'schedule',
  weekdays: [],
  start: '2026-11-09',
  until: null,
  deadlineDays: null,
  ...over,
})

describe('datums', () => {
  it('kort een maand in', () => {
    expect(addMonths('2026-01-31', 1)).toBe('2026-02-28')
    expect(addMonths('2026-02-28', 1, 31)).toBe('2026-03-31')
    expect(addMonths('2024-02-29', 12, 29)).toBe('2025-02-28')
  })
  it('telt dagen', () => {
    expect(daysBetween('2026-11-09', '2026-11-12')).toBe(3)
    expect(daysBetween('2026-11-09', '2026-11-08')).toBe(-1)
  })
})

describe('herhaling', () => {
  it('elke 3 dagen op schema', () => {
    const r = rule({ every: 3 })
    expect(nextOccurrence(r, '2026-11-09', '2026-11-09')).toBe('2026-11-12')
    expect(nextOccurrence(r, '2026-11-12', '2026-11-20')).toBe('2026-11-21')
  })
  it('wekelijks op maandag en donderdag', () => {
    const r = rule({ unit: 'week', weekdays: [1, 4] })
    expect(nextOccurrence(r, '2026-11-09', '2026-11-09')).toBe('2026-11-12')
    expect(nextOccurrence(r, '2026-11-12', '2026-11-12')).toBe('2026-11-16')
  })
  it('om de week op de weekdag van start', () => {
    const r = rule({ unit: 'week', every: 2 })
    expect(nextOccurrence(r, '2026-11-09', '2026-11-09')).toBe('2026-11-23')
  })
  it('maandelijks op de 31e kort in', () => {
    const r = rule({ unit: 'month', start: '2026-01-31' })
    expect(nextOccurrence(r, '2026-01-31', '2026-01-31')).toBe('2026-02-28')
    expect(nextOccurrence(r, '2026-02-28', '2026-02-28')).toBe('2026-03-31')
  })
  it('jaarlijks op 29 februari', () => {
    const r = rule({ unit: 'year', start: '2024-02-29' })
    expect(nextOccurrence(r, '2024-02-29', '2024-02-29')).toBe('2025-02-28')
    expect(nextOccurrence(r, '2027-02-28', '2027-02-28')).toBe('2028-02-29')
  })
  it('slaat gemiste keren over en stopt na until', () => {
    const r = rule({ unit: 'week', until: '2026-12-01' })
    expect(nextOccurrence(r, '2026-11-09', '2026-11-25')).toBe('2026-11-30')
    expect(nextOccurrence(r, '2026-11-30', '2026-11-30')).toBeNull()
  })
  it('na afronden telt vanaf de afronddag', () => {
    const r = rule({ unit: 'week', every: 2, basis: 'completion' })
    expect(nextOccurrence(r, '2026-11-11', '2026-11-11')).toBe('2026-11-25')
    expect(firstOccurrence(r, '2026-11-09')).toBe('2026-11-09')
  })
  it('eerste keer is start of de eerste match erna', () => {
    expect(firstOccurrence(rule({}), '2026-11-09')).toBe('2026-11-09')
    expect(firstOccurrence(rule({ unit: 'week', weekdays: [3] }), '2026-11-09')).toBe('2026-11-11')
  })
  it('maakt een exemplaar met deadline', () => {
    const template = newTask({
      title: 'Planten water geven',
      repeat: rule({ deadlineDays: 2 }),
      projectId: '01ARZ3NDEKTSV4RRFFQ69G5FAV',
      when: { kind: 'anytime' },
    })
    const task = instanceOf(template, '2026-11-12', 'a0')
    expect(task.templateId).toBe(template.id)
    expect(task.repeat).toBeNull()
    expect(task.when).toEqual({ kind: 'date', date: '2026-11-12' })
    expect(task.deadline).toBe('2026-11-14')
    expect(task.projectId).toBe(template.projectId)
    expect(task.id).not.toBe(template.id)
  })
})
