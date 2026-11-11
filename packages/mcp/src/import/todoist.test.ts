import { applyChange, type Change, type EntityRecord, recordKey } from '@dingen/core'
import { describe, expect, it } from 'vitest'
import { DingenClient, type SyncTransport } from '../client.js'
import { describePlan, writePlan } from './common.js'
import {
  parseTodoistDate,
  parseTodoistRepeat,
  planTodoistImport,
  projectNameOf,
} from './todoist.js'

const TODAY = '2026-11-09'
const HEADER = 'TYPE,CONTENT,DESCRIPTION,PRIORITY,INDENT,AUTHOR,RESPONSIBLE,DATE,DATE_LANG,TIMEZONE'
const GARDEN = `${HEADER}
section,Spring,,,,,,,,
task,Buy paint,"Two litres, white",4,1,Sam (1),,12 Dec 2026,en,Europe/Amsterdam
task,Sand the gate,,1,1,Sam (1),,,en,
task,Remove rust,,4,2,Sam (1),,,en,
task,Brush,,4,2,Sam (1),,,en,
note,"Ask the neighbour, he has a brush",,,,,,,,
section,Summer,,,,,,,,
task,Water the plants,,4,1,Sam (1),,every monday and thursday,en,
task,Mow,,4,1,Sam (1),,every! 2 weeks,en,
task,Pay rent,,4,1,Sam (1),,every 15th,en,
task,Call at noon,,4,1,Sam (1),,2026-11-20 12:30,en,
task,Odd one,,4,1,Sam (1),,when the sun shines,en,
task,Strange repeat,,4,1,Sam (1),,every full moon,en,
meta,view_style=list,,,,,,,,
`
const INBOX = `${HEADER}
task,Ring the bank,,4,1,Sam (1),,,en,
task,Ring the bank,,4,1,Sam (1),,,en,
task,Fill in form,,4,1,Sam (1),,2026-11-12,en,
`

describe('todoist import', () => {
  const plan = planTodoistImport(
    [
      { name: 'Garden [1234].csv', text: GARDEN },
      { name: 'Inbox.csv', text: INBOX },
    ],
    { today: TODAY, area: 'Home' },
  )
  const task = (title: string) => {
    const t = plan.tasks.find((t) => t.title === title && t.repeat === null)
    if (!t) throw new Error(`no task ${title}`)
    return t
  }

  it('names projects after the file and the Inbox after Inbox', () => {
    expect(projectNameOf('/x/Garden [1234].csv')).toBe('Garden')
    expect(plan.projects.map((p) => p.title)).toEqual(['Garden'])
    expect(plan.areas.map((a) => a.title)).toEqual(['Home'])
    expect(plan.projects[0]?.areaId).toBe(plan.areas[0]?.id)
    expect(task('Fill in form')).toMatchObject({
      projectId: null,
      when: { kind: 'date', date: '2026-11-12' },
    })
    expect(plan.tasks.filter((t) => t.title === 'Ring the bank')).toHaveLength(2)
    expect(task('Ring the bank').when).toEqual({ kind: 'inbox' })
  })

  it('turns sections into headings and subtasks into a checklist', () => {
    expect(plan.headings?.map((h) => h.title)).toEqual(['Spring', 'Summer'])
    const paint = task('Buy paint')
    expect(paint.headingId).toBe(plan.headings?.[0]?.id)
    expect(paint.when).toEqual({ kind: 'date', date: '2026-12-12' })
    const sand = task('Sand the gate')
    expect(sand.when).toEqual({ kind: 'anytime' })
    expect(plan.checklist.filter((c) => c.taskId === sand.id).map((c) => c.title)).toEqual([
      'Remove rust',
      'Brush',
    ])
    expect(plan.tasks.map((t) => t.title)).not.toContain('Brush')
  })

  it('appends comments to the notes and keeps the description', () => {
    expect(task('Buy paint').notes).toBe('Two litres, white')
    expect(task('Sand the gate').notes).toBe('Ask the neighbour, he has a brush')
  })

  it('imports repeating tasks as template plus first instance', () => {
    const template = plan.tasks.find((t) => t.title === 'Water the plants' && t.repeat)
    expect(template?.repeat).toMatchObject({ unit: 'week', weekdays: [1, 4], basis: 'schedule' })
    expect(plan.tasks.filter((t) => t.title === 'Water the plants')).toHaveLength(2)
    const mow = plan.tasks.find((t) => t.title === 'Mow' && t.repeat)
    expect(mow?.repeat).toMatchObject({ unit: 'week', every: 2, basis: 'completion' })
    const rent = plan.tasks.find((t) => t.title === 'Pay rent' && t.repeat)
    expect(rent?.repeat).toMatchObject({ unit: 'month', start: '2026-11-15' })
  })

  it('warns about times, unknown dates and unknown repeats', () => {
    expect(plan.warnings.some((w) => w.includes('time of day') && w.includes('Call at noon'))).toBe(
      true,
    )
    expect(task('Call at noon').when).toEqual({ kind: 'date', date: '2026-11-20' })
    expect(plan.warnings.some((w) => w.includes('"Odd one"') && w.includes('not understood'))).toBe(
      true,
    )
    expect(plan.warnings.some((w) => w.includes('every full moon'))).toBe(true)
    expect(plan.tasks.some((t) => t.title === 'Strange repeat' && t.repeat === null)).toBe(true)
  })

  it('reports counts and rejects other files', () => {
    const text = describePlan(plan)
    expect(text).toContain('Garden:')
    expect(text).toContain('Inbox: 3 (3 open, 0 done)')
    expect(() =>
      planTodoistImport([{ name: 'x.csv', text: 'a,b\n1,2\n' }], { today: TODAY }),
    ).toThrow(/Not a Todoist export/)
  })

  it('reads the date notations Todoist exports', () => {
    expect(parseTodoistDate('Nov 20 2026', TODAY).date).toBe('2026-11-20')
    expect(parseTodoistDate('20 Nov', TODAY).date).toBe('2026-11-20')
    expect(parseTodoistDate('5 Jan', TODAY).date).toBe('2027-01-05')
    expect(parseTodoistDate('2026-11-20T09:00:00', TODAY)).toMatchObject({
      date: '2026-11-20',
      time: '09:00',
    })
    expect(parseTodoistDate('every day', TODAY).recurring).toBe('every day')
    expect(parseTodoistDate('', TODAY).date).toBeNull()
  })

  it('reads repeat phrases', () => {
    const rule = (s: string) => parseTodoistRepeat(s, TODAY, () => {})
    expect(rule('every day')).toMatchObject({ unit: 'day', every: 1 })
    expect(rule('every other day')).toMatchObject({ unit: 'day', every: 2 })
    expect(rule('every 3 months')).toMatchObject({ unit: 'month', every: 3 })
    expect(rule('every workday')?.weekdays).toEqual([1, 2, 3, 4, 5])
    expect(rule('every mon, thu')?.weekdays).toEqual([1, 4])
    expect(rule('every 12 mar')).toMatchObject({ unit: 'year', start: '2027-03-12' })
    expect(rule('every week ending 2027-01-01')?.until).toBe('2027-01-01')
    expect(rule('every banana')).toBeNull()
  })

  it('is idempotent against a running server', async () => {
    const records = new Map<string, EntityRecord>()
    const log: Change[] = []
    const transport: SyncTransport = {
      snapshot: async () => ({ entities: [...records.values()], seq: log.length }),
      pull: async (since) => ({ changes: log.slice(since), seq: log.length, hasMore: false }),
      push: async (changes) => {
        for (const c of changes) {
          const key = recordKey(c.entityType, c.entityId)
          records.set(key, applyChange(records.get(key), c))
          log.push(c)
        }
        return { seq: log.length, applied: changes.length, duplicates: 0 }
      },
    }
    const files = [
      { name: 'Garden.csv', text: GARDEN },
      { name: 'Inbox.csv', text: INBOX },
    ]
    const apply = async () => {
      const client = new DingenClient(transport, { today: () => TODAY })
      await client.refresh()
      const res = writePlan(client, planTodoistImport(files, { today: TODAY }))
      await client.flush()
      return res
    }
    const first = await apply()
    expect(first.created.heading).toBe(2)
    expect(first.alreadyThere).toBe(0)
    const second = await apply()
    expect(second.alreadyThere).toBeGreaterThan(0)
    expect(Object.values(second.created).every((n) => n === 0)).toBe(true)
  })
})
