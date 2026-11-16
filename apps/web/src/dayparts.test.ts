import type { CalendarEvent, Daypart, Task } from '@dingen/core'
import { describe, expect, it } from 'vitest'
import {
  durationText,
  eventsByDaypart,
  nextWeek,
  showsDaypart,
  tasksByDaypart,
  totalText,
  whenFields,
  whenOptions,
} from './dayparts.js'

// 2026-11-16 is a Monday.
const MONDAY = '2026-11-16'

describe('nextWeek', () => {
  it('is the Monday of next week', () => {
    expect(nextWeek(MONDAY)).toBe('2026-11-23')
    expect(nextWeek('2026-11-18')).toBe('2026-11-23') // Wednesday
    expect(nextWeek('2026-11-21')).toBe('2026-11-23') // Saturday
    expect(nextWeek('2026-11-22')).toBe('2026-11-23') // Sunday: tomorrow
  })

  it('crosses months and years', () => {
    expect(nextWeek('2026-12-31')).toBe('2027-01-04')
  })
})

describe('whenOptions', () => {
  const keys = (opts: ReturnType<typeof whenOptions>) => opts.map((o) => o.key)
  const active = (opts: ReturnType<typeof whenOptions>) =>
    opts.filter((o) => o.active).map((o) => o.key)

  it('offers Inbox, Today, Tomorrow, Next week, Anytime and Someday', () => {
    const opts = whenOptions({ kind: 'inbox' }, MONDAY)
    expect(keys(opts)).toEqual(['inbox', 'today', 'tomorrow', 'nextWeek', 'anytime', 'someday'])
    expect(opts.find((o) => o.key === 'nextWeek')?.when).toEqual({
      kind: 'date',
      date: '2026-11-23',
    })
    expect(active(opts)).toEqual(['inbox'])
  })

  it('has no Inbox for a project and always closes there', () => {
    const opts = whenOptions({ kind: 'anytime' }, MONDAY, true)
    expect(keys(opts)).not.toContain('inbox')
    expect(opts.every((o) => o.close)).toBe(true)
  })

  it('keeps the picker open after a date, so a daypart can follow', () => {
    const opts = whenOptions({ kind: 'anytime' }, MONDAY)
    expect(opts.filter((o) => !o.close).map((o) => o.key)).toEqual([
      'today',
      'tomorrow',
      'nextWeek',
    ])
  })

  it('marks the current date', () => {
    expect(active(whenOptions({ kind: 'date', date: '2026-11-10' }, MONDAY))).toEqual(['today'])
    expect(active(whenOptions({ kind: 'date', date: '2026-11-17' }, MONDAY))).toEqual(['tomorrow'])
    expect(active(whenOptions({ kind: 'date', date: '2026-11-23' }, MONDAY))).toEqual(['nextWeek'])
    expect(active(whenOptions({ kind: 'date', date: '2026-11-25' }, MONDAY))).toEqual([])
    // On a Sunday tomorrow is next week.
    expect(active(whenOptions({ kind: 'date', date: '2026-11-23' }, '2026-11-22'))).toEqual([
      'tomorrow',
      'nextWeek',
    ])
  })
})

describe('whenFields', () => {
  it('keeps the daypart with a date and clears it without one', () => {
    expect(whenFields({ kind: 'date', date: MONDAY }, 'afternoon')).toEqual({
      when: { kind: 'date', date: MONDAY },
      daypart: 'afternoon',
    })
    expect(whenFields({ kind: 'someday' }, 'evening')).toEqual({
      when: { kind: 'someday' },
      daypart: null,
    })
  })
})

describe('tasksByDaypart', () => {
  it('groups in the given order', () => {
    const t = (id: string, daypart: Daypart | null) => ({ id, daypart })
    const groups = tasksByDaypart([
      t('a', 'evening'),
      t('b', null),
      t('c', 'morning'),
      t('d', 'evening'),
    ])
    expect(groups.none.map((x) => x.id)).toEqual(['b'])
    expect(groups.morning.map((x) => x.id)).toEqual(['c'])
    expect(groups.afternoon).toEqual([])
    expect(groups.evening.map((x) => x.id)).toEqual(['a', 'd'])
  })
})

function event(
  id: string,
  startTime: string | null,
  startDate = MONDAY,
  endDate = startDate,
): CalendarEvent {
  return {
    id,
    calendarId: 'cal',
    title: id,
    location: null,
    allDay: startTime === null,
    startDate,
    endDate,
    startTime,
    endTime: startTime,
    start: `${startDate}T00:00:00.000Z`,
    end: `${endDate}T00:00:00.000Z`,
  }
}

describe('eventsByDaypart', () => {
  it('puts an event under the daypart of its start time', () => {
    const groups = eventsByDaypart(
      [
        event('dinner', '18:00'),
        event('standup', '09:30'),
        event('lunch', '12:00'),
        event('early', '07:00'),
        event('late-morning', '11:59'),
        event('holiday', null),
      ],
      MONDAY,
    )
    expect(groups.none.map((e) => e.id)).toEqual(['holiday'])
    expect(groups.morning.map((e) => e.id)).toEqual(['early', 'standup', 'late-morning'])
    expect(groups.afternoon.map((e) => e.id)).toEqual(['lunch'])
    expect(groups.evening.map((e) => e.id)).toEqual(['dinner'])
  })

  it('keeps events that started earlier at the top and skips other days', () => {
    const groups = eventsByDaypart(
      [
        event('trip', '20:00', '2026-11-15', '2026-11-17'),
        event('ends-today', '20:00', '2026-11-15', MONDAY),
        event('starts-today', '20:00', MONDAY, '2026-11-17'),
        event('tomorrow', '10:00', '2026-11-17'),
      ],
      MONDAY,
    )
    expect(groups.none.map((e) => e.id).sort()).toEqual(['ends-today', 'trip'])
    expect(groups.evening.map((e) => e.id)).toEqual(['starts-today'])
    expect(groups.morning).toEqual([])
  })
})

describe('showsDaypart', () => {
  it('shows a heading with tasks or events, or while dragging', () => {
    expect(showsDaypart(0, 0, false)).toBe(false)
    expect(showsDaypart(1, 0, false)).toBe(true)
    expect(showsDaypart(0, 2, false)).toBe(true)
    expect(showsDaypart(0, 0, true)).toBe(true)
  })
})

describe('totals', () => {
  type T = Pick<Task, 'duration' | 'status'>
  const open = (duration: number | null): T => ({ duration, status: 'open' })

  it('uses the hour unit of the language', () => {
    expect(durationText(90, 'nl')).toBe('1u30')
    expect(durationText(90, 'en')).toBe('1h30')
    expect(durationText(15, 'nl')).toBe('15m')
  })

  it('adds up open tasks and is null at zero', () => {
    expect(totalText([open(30), open(null), open(45)], 'nl')).toBe('1u15')
    expect(totalText([open(null)], 'en')).toBeNull()
    expect(totalText([], 'en')).toBeNull()
    expect(totalText([open(60), { duration: 120, status: 'completed' }], 'en')).toBe('1h')
  })
})
