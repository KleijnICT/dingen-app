import type { ActivityItem } from '@dingen/core'
import { describe, expect, it } from 'vitest'
import { describeLine, groupByDay, kindsFor, mergeFresh } from './activity.js'
import type { Workspace } from './store/context.js'

const item = (seq: number, at: string, over: Partial<ActivityItem> = {}): ActivityItem => ({
  seq,
  at,
  actor: 'user:U1',
  kind: 'added',
  entityType: 'task',
  entityId: `T${seq}`,
  title: `Task ${seq}`,
  container: null,
  fields: [],
  ...over,
})

const ws = {
  today: '2026-11-12',
  projectById: new Map(),
  areaById: new Map(),
  headingById: new Map(),
  tagById: new Map(),
} as unknown as Workspace
const ctx = { ws, memberName: () => undefined }

describe('activity lines', () => {
  it('says what changed, with the value before and after', () => {
    const line = item(1, '2026-11-12T10:00:00Z', {
      kind: 'updated',
      fields: [
        { field: 'when', from: { kind: 'date', date: '2026-11-12' }, to: { kind: 'anytime' } },
        { field: 'notes', from: null, to: null },
      ],
    })
    expect(describeLine(line, 'You', ctx)).toBe(
      'You changed When from today to Anytime and the notes',
    )
    expect(describeLine(item(2, '2026-11-12T10:00:00Z'), 'Research', ctx)).toBe('Research added')
    const canceled = item(3, '2026-11-12T10:00:00Z', {
      kind: 'completed',
      fields: [{ field: 'status', from: null, to: 'canceled' }],
    })
    expect(describeLine(canceled, 'You', ctx)).toBe('You canceled')
  })

  it('maps the Changed filter to updated and reopened', () => {
    expect(kindsFor('all')).toBeUndefined()
    expect(kindsFor('updated')).toEqual(['updated', 'reopened'])
  })

  it('groups per local day, keeping the order', () => {
    const groups = groupByDay([
      item(3, new Date(2026, 10, 12, 9).toISOString()),
      item(2, new Date(2026, 10, 12, 8).toISOString()),
      item(1, new Date(2026, 10, 11, 20).toISOString()),
    ])
    expect(groups.map((g) => [g.date, g.items.length])).toEqual([
      ['2026-11-12', 2],
      ['2026-11-11', 1],
    ])
  })

  it('puts a fresh first page on top of older loaded lines', () => {
    const loaded = [item(9, 'x'), item(5, 'x'), item(3, 'x')]
    const fresh = { items: [item(12, 'x'), item(9, 'x')], nextBefore: 6 }
    const merged = mergeFresh(fresh, loaded, 2)
    expect(merged.items.map((i) => i.seq)).toEqual([12, 9, 5, 3])
    expect(merged.nextBefore).toBe(2)
    expect(mergeFresh({ items: [], nextBefore: null }, loaded, 2)).toEqual({
      items: [],
      nextBefore: null,
    })
  })
})
