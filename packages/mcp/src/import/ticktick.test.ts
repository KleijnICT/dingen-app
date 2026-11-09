import { ULID_PATTERN } from '@dingen/core'
import { describe, expect, it } from 'vitest'
import { parseTickTickCsv, planTickTickImport, stableId } from './ticktick.js'

const CSV = `"Date: 2026-11-09+0000"
"Version: 7.1"
"Status: 0 Normal, 1 Completed, 2 Archived"
""
"Folder Name","List Name","Title","Kind","Tags","Content","Is Check list","Start Date","Due Date","Reminder","Repeat","Priority","Status","Created Time","Completed Time","Order","Timezone","Is All Day","Is Floating","Column Name","Column Order","View Mode","taskId","parentId"
"🏡 Persoonlijk","Persoonlijk algemeen","Bel de tandarts","TEXT","waiting, anne","Vragen naar de controle","N","2026-11-10T23:00:00+0000","2026-11-10T23:00:00+0000","","","0","0","2026-11-01T10:00:00+0000","","-1099511627776","Europe/Amsterdam","true","false","","","list","t1",""
"🏡 Persoonlijk","Persoonlijk algemeen","Belasting aangifte","TEXT","","","N","2026-11-10T23:00:00+0000","2026-11-30T23:00:00+0000","","","5","0","2026-11-01T10:00:00+0000","","-549755813888","Europe/Amsterdam","true","false","","","list","t2",""
"🏡 Persoonlijk","💰Financien","Hypotheek oversluiten","CHECKLIST","","▪Rente vergelijken
▫Adviseur bellen","Y","","","","","0","0","2026-11-01T10:00:00+0000","","0","Europe/Amsterdam","true","false","","","list","t3",""
"🏡 Persoonlijk","💰Financien","Oude taak","TEXT","","","N","","","","","0","2","2026-10-01T10:00:00+0000","2026-10-05T10:00:00+0000","1","Europe/Amsterdam","true","false","","","list","t4",""
"","Inbox","Iets nieuws","TEXT","","Met een ""quote"", en een komma","N","","","","","0","0","2026-11-08T10:00:00+0000","","0","Europe/Amsterdam","true","false","","","list","t5",""
"","💭 Someday","Ooit een boot","TEXT","","","N","","","","","0","0","2026-11-08T10:00:00+0000","","0","Europe/Amsterdam","true","false","","","list","t6",""
"🏡 Persoonlijk","🧺 Huishouden","Planten water geven","TEXT","","","N","2026-11-08T23:00:00+0000","2026-11-08T23:00:00+0000","","RRULE:FREQ=WEEKLY;INTERVAL=1;BYDAY=MO,TH","0","0","2026-11-01T10:00:00+0000","","0","Europe/Amsterdam","true","false","","","list","t7",""
"🏡 Persoonlijk","🧺 Huishouden","Boodschappen","TEXT","","","N","","","","","0","0","2026-11-01T10:00:00+0000","","1","Europe/Amsterdam","true","false","","","list","t8",""
"🏡 Persoonlijk","🧺 Huishouden","Melk","TEXT","","","N","","","","","0","0","2026-11-01T10:00:00+0000","","0","Europe/Amsterdam","true","false","","","list","t9","t8"
"🏡 Persoonlijk","🧺 Huishouden","Brood","TEXT","","","N","","","","","0","2","2026-11-01T10:00:00+0000","2026-11-02T10:00:00+0000","1","Europe/Amsterdam","true","false","","","list","t10","t8"
"","👋Welcome","Welcome to TickTick","TEXT","","","N","","","","","0","0","2026-11-01T10:00:00+0000","","0","Europe/Amsterdam","true","false","","","list","t11",""
`

describe('ticktick import', () => {
  const rows = parseTickTickCsv(CSV)
  const plan = planTickTickImport(rows, {
    today: '2026-11-09',
    timezone: 'Europe/Amsterdam',
    closedLists: ['👋Welcome'],
    tagParents: { anne: 'personen' },
  })
  const task = (title: string) => {
    const t = plan.tasks.find((t) => t.title === title && t.repeat === null)
    if (!t) throw new Error(`no task ${title}`)
    return t
  }

  it('reads the preamble, quotes and embedded newlines', () => {
    expect(rows).toHaveLength(11)
    expect(rows[4]?.content).toBe('Met een "quote", en een komma')
    expect(rows[2]?.content.split('\n')).toHaveLength(2)
  })

  it('maps folders to areas and lists to projects or loose tasks', () => {
    expect(plan.areas.map((a) => a.title)).toEqual(['🏡 Persoonlijk'])
    expect(plan.projects.map((p) => p.title).sort()).toEqual(['💰Financien', '🧺 Huishouden'])
    const area = plan.areas[0]
    expect(task('Bel de tandarts')).toMatchObject({ areaId: area?.id, projectId: null })
    expect(task('Hypotheek oversluiten').projectId).toBe(
      plan.projects.find((p) => p.title === '💰Financien')?.id,
    )
    expect(task('Iets nieuws').when).toEqual({ kind: 'inbox' })
    expect(task('Ooit een boot').when).toEqual({ kind: 'someday' })
    expect(plan.skipped.tasksInClosedLists).toBe(1)
  })

  it('turns dates into plan and deadline per the priority rule', () => {
    expect(task('Bel de tandarts')).toMatchObject({
      when: { kind: 'date', date: '2026-11-11' },
      deadline: null,
    })
    expect(task('Belasting aangifte')).toMatchObject({
      when: { kind: 'date', date: '2026-11-11' },
      deadline: '2026-12-01',
    })
    expect(task('Hypotheek oversluiten').when).toEqual({ kind: 'anytime' })
  })

  it('keeps tags with parents, status and completion', () => {
    const tags = Object.fromEntries(plan.tags.map((t) => [t.title, t]))
    expect(tags.anne?.parentId).toBe(tags.personen?.id)
    expect(task('Bel de tandarts').tagIds).toEqual([tags.waiting?.id, tags.anne?.id])
    expect(task('Oude taak')).toMatchObject({
      status: 'completed',
      completedAt: '2026-10-05T10:00:00.000Z',
    })
  })

  it('builds checklists from content and from subtasks', () => {
    const hypo = plan.checklist.filter((c) => c.taskId === task('Hypotheek oversluiten').id)
    expect(hypo.map((c) => [c.title, c.done])).toEqual([
      ['Rente vergelijken', true],
      ['Adviseur bellen', false],
    ])
    expect(task('Hypotheek oversluiten').notes).toBe('')
    const shop = plan.checklist.filter((c) => c.taskId === task('Boodschappen').id)
    expect(shop.map((c) => [c.title, c.done])).toEqual([
      ['Melk', false],
      ['Brood', true],
    ])
    expect(plan.tasks.find((t) => t.title === 'Melk')).toBeUndefined()
  })

  it('turns an RRULE into a template plus first instance', () => {
    const template = plan.tasks.find((t) => t.title === 'Planten water geven' && t.repeat !== null)
    const instance = task('Planten water geven')
    expect(template?.repeat).toMatchObject({ unit: 'week', every: 1, weekdays: [1, 4] })
    expect(instance.templateId).toBe(template?.id)
    expect(instance.when).toEqual({ kind: 'date', date: '2026-11-09' })
    expect(plan.warnings.some((w) => w.includes('after completion'))).toBe(true)
  })

  it('is deterministic', () => {
    expect(stableId('task:t1')).toMatch(ULID_PATTERN)
    expect(stableId('task:t1')).toBe(stableId('task:t1'))
    expect(stableId('task:t1')).not.toBe(stableId('task:t2'))
    const again = planTickTickImport(rows, { today: '2026-11-09', closedLists: ['👋Welcome'] })
    expect(again.tasks.map((t) => t.id)).toEqual(plan.tasks.map((t) => t.id))
  })
})
