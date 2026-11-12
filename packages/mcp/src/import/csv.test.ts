import { readFileSync } from 'node:fs'
import { applyChange, type Change, type EntityRecord, recordKey } from '@dingen/core'
import { describe, expect, it } from 'vitest'
import { DingenClient, type SyncTransport } from '../client.js'
import { describePlan, writePlan } from './common.js'
import { planCsvImport } from './csv.js'

const TODAY = '2026-11-09'
const CSV = `Title,Notes,Project,Area,Tags,When,Deadline,Done
Bel de tandarts,"Vragen naar de controle, ook de kosten",,Thuis,"gezondheid; bellen",tomorrow,,
Poort repareren,,Tuin,Thuis,,anytime,,
Verf kopen,"Regel 1
Regel 2",Tuin,Thuis,,2026-12-05,,
Belasting,,,Financien,,2026-12-10,2026-12-31,
Ooit een boot,,,,,someday,,
Planten water geven,,,,,,,yes
Los ding,,,,,,,
Los ding,,,,,,,
Kapotte datum,,,,,next week,31-12-2026,
,,,,,,,
Extra,,,,,,,
`

describe('generic csv import', () => {
  const plan = planCsvImport(CSV, { today: TODAY })
  const task = (title: string, n = 0) => plan.tasks.filter((t) => t.title === title)[n]

  it('maps columns to tasks, projects, areas and tags', () => {
    expect(plan.areas.map((a) => a.title)).toEqual(['Thuis', 'Financien'])
    expect(plan.projects.map((p) => p.title)).toEqual(['Tuin'])
    expect(plan.projects[0]?.areaId).toBe(plan.areas[0]?.id)
    expect(plan.tags.map((t) => t.title)).toEqual(['gezondheid', 'bellen'])
    expect(task('Bel de tandarts')).toMatchObject({
      notes: 'Vragen naar de controle, ook de kosten',
      areaId: plan.areas[0]?.id,
      projectId: null,
      when: { kind: 'date', date: '2026-11-10' },
    })
    expect(task('Bel de tandarts')?.tagIds).toHaveLength(2)
    expect(task('Poort repareren')).toMatchObject({
      projectId: plan.projects[0]?.id,
      when: { kind: 'anytime' },
    })
    expect(task('Verf kopen')?.notes).toBe('Regel 1\nRegel 2')
    expect(task('Verf kopen')?.when).toEqual({ kind: 'date', date: '2026-12-05' })
  })

  it('handles deadline, someday, done and the inbox', () => {
    expect(task('Belasting')).toMatchObject({
      deadline: '2026-12-31',
      when: { kind: 'date', date: '2026-12-10' },
    })
    expect(task('Ooit een boot')?.when).toEqual({ kind: 'someday' })
    expect(task('Planten water geven')).toMatchObject({ status: 'completed' })
    expect(task('Planten water geven')?.completedAt).not.toBeNull()
    expect(task('Los ding')?.when).toEqual({ kind: 'inbox' })
  })

  it('keeps equal titles apart but stable', () => {
    expect(task('Los ding', 0)?.id).not.toBe(task('Los ding', 1)?.id)
    const again = planCsvImport(CSV, { today: TODAY })
    expect(again.tasks.map((t) => t.id)).toEqual(plan.tasks.map((t) => t.id))
  })

  it('warns about what it cannot read and skips empty rows', () => {
    expect(plan.warnings.some((w) => w.includes('when "next week"'))).toBe(true)
    expect(plan.warnings.some((w) => w.includes('deadline "31-12-2026"'))).toBe(true)
    expect(plan.tasks.map((t) => t.title)).not.toContain('')
    expect(plan.tasks).toHaveLength(10)
  })

  it('reads a semicolon file and a BOM, and rejects other files', () => {
    const p = planCsvImport('﻿title;notes;project\n"A; b";hoi;P\n', { today: TODAY })
    expect(p.tasks[0]).toMatchObject({ title: 'A; b', notes: 'hoi' })
    expect(p.projects[0]?.title).toBe('P')
    expect(() => planCsvImport('name,what\nx,y\n', { today: TODAY })).toThrow(/"title" column/)
  })

  it('reports unknown columns and counts per area', () => {
    const p = planCsvImport('title,colour\nA,red\n', { today: TODAY })
    expect(p.warnings[0]).toContain('colour')
    const text = describePlan(plan)
    expect(text).toContain('Thuis: 3')
    expect(text).toContain('    Tuin: 2 (2 open, 0 done)')
  })

  it('parses the example file from the docs without warnings', () => {
    const example = readFileSync(
      new URL('../../../../examples/import-example.csv', import.meta.url),
      'utf8',
    )
    const p = planCsvImport(example, { today: TODAY })
    expect(p.warnings).toEqual([])
    expect(p.tasks).toHaveLength(7)
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
    const apply = async () => {
      const client = new DingenClient(transport, { today: () => TODAY })
      await client.refresh()
      const res = writePlan(client, planCsvImport(CSV, { today: TODAY }))
      await client.flush()
      return res
    }
    const first = await apply()
    expect(first.created.task).toBe(plan.tasks.length)
    expect(first.alreadyThere).toBe(0)
    const second = await apply()
    expect(second.alreadyThere).toBeGreaterThan(0)
    expect(Object.values(second.created).every((n) => n === 0)).toBe(true)
  })
})
