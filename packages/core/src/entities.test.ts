import { describe, expect, it } from 'vitest'
import { AREA_COLORS, AREA_ICONS, Area, validateChangeFields } from './entities.js'
import { newArea } from './factories.js'
import { createClock } from './hlc.js'
import { ulid } from './ids.js'

describe('Area', () => {
  it('parses an area synced before icon and color existed, with nulls', () => {
    const old = {
      id: ulid(),
      createdAt: new Date().toISOString(),
      deleted: false,
      title: 'Home',
      order: 'a',
    }
    const parsed = Area.parse(old)
    expect(parsed.icon).toBeNull()
    expect(parsed.color).toBeNull()
  })

  it('keeps unknown ids from a newer version', () => {
    expect(Area.parse({ ...newArea({ title: 'x' }), icon: 'future', color: 'teal' }).icon).toBe(
      'future',
    )
  })

  it('accepts icon and color through server-side validation', () => {
    const area = newArea({ title: 'x' })
    const { id, ...fields } = area
    const change = {
      id: ulid(),
      entityType: 'area' as const,
      entityId: id,
      fields: { ...fields, icon: AREA_ICONS[0], color: AREA_COLORS[1] },
      ts: createClock('A', () => 1000).now(),
      clientId: 'c',
    }
    expect(validateChangeFields(change, undefined).ok).toBe(true)
    expect(validateChangeFields({ ...change, fields: { icon: 'home' } }, { ...area }).ok).toBe(true)
  })

  it('has unique ids', () => {
    expect(new Set(AREA_ICONS).size).toBe(AREA_ICONS.length)
    expect(AREA_COLORS).toHaveLength(10)
  })
})
