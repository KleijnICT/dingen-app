import type { ActivityItem } from '@dingen/core'
import { describe, expect, it } from 'vitest'
import { actorName, describeLine, groupByDay, kindsFor, mergeFresh } from './activity.js'
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
  it('names the server itself as Dingen', () => {
    const line = item(1, '2026-11-12T10:00:00Z', {
      actor: 'system',
      kind: 'updated',
      fields: [{ field: 'tagIds', from: [], to: [] }],
    })
    const name = actorName(line.actor, 'user:U1', undefined)
    expect(name).toBe('Dingen')
    expect(describeLine(line, name, ctx)).toMatch(/^Dingen changed the tags/)
    expect(actorName('user:U1', 'user:U1', undefined)).toBe('You')
  })

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

  it('says where a move between spaces went', () => {
    const moved = (to: string) =>
      item(4, '2026-11-12T10:00:00Z', {
        kind: 'moved',
        fields: [{ field: 'space', from: null, to }],
      })
    expect(describeLine(moved('shared'), 'You', ctx)).toBe('You moved this to a shared space')
    expect(describeLine(moved('personal'), 'You', ctx)).toBe('You moved this to the personal space')
  })

  it('maps the Changed filter to updated, reopened and moved', () => {
    expect(kindsFor('all')).toBeUndefined()
    expect(kindsFor('updated')).toEqual(['updated', 'reopened', 'moved'])
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
