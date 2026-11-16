import { describe, expect, it } from 'vitest'
import {
  durationText,
  filterByDuration,
  parseDuration,
  readDurationFilter,
  writeDurationFilter,
} from './duration.js'

describe('durationText', () => {
  it('writes hours as u in Dutch and h in English', () => {
    expect(durationText(15, 'en')).toBe('15m')
    expect(durationText(60, 'nl')).toBe('1u')
    expect(durationText(90, 'nl')).toBe('1u30')
    expect(durationText(120, 'en')).toBe('2h')
  })
})

describe('parseDuration', () => {
  it('reads plain minutes', () => {
    expect(parseDuration('45')).toBe(45)
    expect(parseDuration(' 45 m ')).toBe(45)
    expect(parseDuration('10min')).toBe(10)
  })

  it('reads hours in Dutch and English, with or without minutes', () => {
    expect(parseDuration('2u')).toBe(120)
    expect(parseDuration('1h30')).toBe(90)
    expect(parseDuration('1u30m')).toBe(90)
    expect(parseDuration('1:15')).toBe(75)
    expect(parseDuration('1,5u')).toBe(90)
    expect(parseDuration('0.5h')).toBe(30)
  })

  it('refuses nothing, nonsense and values outside 1 to 1440 minutes', () => {
    expect(parseDuration('')).toBeNull()
    expect(parseDuration('soon')).toBeNull()
    expect(parseDuration('0')).toBeNull()
    expect(parseDuration('1441')).toBeNull()
    expect(parseDuration('25u')).toBeNull()
    expect(parseDuration('-5')).toBeNull()
  })
})

describe('filterByDuration', () => {
  const tasks = [
    { id: 'a', duration: 5 },
    { id: 'b', duration: 30 },
    { id: 'c', duration: null },
    { id: 'd', duration: 60 },
  ]
  const ids = (list: { id: string }[]) => list.map((task) => task.id)

  it('keeps everything without a filter', () => {
    expect(filterByDuration(tasks, null)).toEqual(tasks)
  })

  it('keeps tasks up to the maximum and drops those without a duration', () => {
    expect(ids(filterByDuration(tasks, 30))).toEqual(['a', 'b'])
    expect(ids(filterByDuration(tasks, 5))).toEqual(['a'])
  })

  it('keeps a task just added, before it has a duration', () => {
    expect(ids(filterByDuration(tasks, 5, ['c']))).toEqual(['a', 'c'])
  })
})

describe('duration filter storage', () => {
  it('keeps a maximum per list', () => {
    let raw = writeDurationFilter('', 'today', 15)
    raw = writeDurationFilter(raw, 'anytime', 60)
    expect(readDurationFilter(raw, 'today')).toBe(15)
    expect(readDurationFilter(raw, 'anytime')).toBe(60)
    raw = writeDurationFilter(raw, 'today', 30)
    expect(readDurationFilter(raw, 'today')).toBe(30)
    expect(raw.split(',')).toHaveLength(2)
  })

  it('turns a list off and ignores what it cannot read', () => {
    const raw = writeDurationFilter('today:15,anytime:60', 'today', null)
    expect(raw).toBe('anytime:60')
    expect(readDurationFilter(raw, 'today')).toBeNull()
    expect(readDurationFilter('today:soon', 'today')).toBeNull()
    expect(readDurationFilter('', 'anytime')).toBeNull()
  })
})
