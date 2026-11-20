import { describe, expect, it } from 'vitest'
import { compareOrder, placeAt, placeBlockAt } from './order.js'

const row = (...orders: string[]) => orders.map((order, i) => ({ id: `i${i}`, order }))
const key = (item: { order: string }) => item.order

describe('placeAt', () => {
  it('puts one key between distinct neighbours and leaves the rest alone', () => {
    const siblings = row('a0', 'a1', 'a2')
    const { order, renumber } = placeAt(siblings, 1, key)
    expect(compareOrder('a0', order)).toBe(-1)
    expect(compareOrder(order, 'a1')).toBe(-1)
    expect(renumber.size).toBe(0)
  })

  it('works at both ends', () => {
    const siblings = row('a0', 'a1')
    expect(compareOrder(placeAt(siblings, 0, key).order, 'a0')).toBe(-1)
    expect(compareOrder('a1', placeAt(siblings, 2, key).order)).toBe(-1)
  })

  it('renumbers the row when neighbours share an order', () => {
    const siblings = row('a0', 'a1', 'a1', 'a2')
    const { order, renumber } = placeAt(siblings, 2, key)
    const final = siblings.map((s) => renumber.get(s.id) ?? s.order)
    final.splice(2, 0, order)
    expect(new Set(final).size).toBe(final.length)
    expect([...final].sort()).toEqual(final)
  })
})

describe('placeBlockAt', () => {
  it('puts the block between distinct neighbours, in its own order', () => {
    const siblings = row('a0', 'a1', 'a2')
    const { orders, renumber } = placeBlockAt(siblings, 1, 3, key)
    expect(orders).toHaveLength(3)
    expect([...orders].sort()).toEqual(orders)
    expect(compareOrder('a0', orders[0] as string)).toBe(-1)
    expect(compareOrder(orders[2] as string, 'a1')).toBe(-1)
    expect(new Set(orders).size).toBe(3)
    expect(renumber.size).toBe(0)
  })

  it('works at both ends and in an empty row', () => {
    const siblings = row('a0', 'a1')
    expect(compareOrder(placeBlockAt(siblings, 0, 2, key).orders[1] as string, 'a0')).toBe(-1)
    expect(compareOrder('a1', placeBlockAt(siblings, 2, 2, key).orders[0] as string)).toBe(-1)
    expect(placeBlockAt([], 0, 2, key).orders).toHaveLength(2)
  })

  it('renumbers the row when neighbours share an order', () => {
    const siblings = row('a0', 'a1', 'a1', 'a2')
    const { orders, renumber } = placeBlockAt(siblings, 2, 2, key)
    const final = siblings.map((s) => renumber.get(s.id) ?? s.order)
    final.splice(2, 0, ...orders)
    expect(new Set(final).size).toBe(final.length)
    expect([...final].sort()).toEqual(final)
  })

  it('matches placeAt for a single item', () => {
    const siblings = row('a0', 'a1', 'a2')
    expect(placeBlockAt(siblings, 1, 1, key).orders).toEqual([placeAt(siblings, 1, key).order])
  })
})
