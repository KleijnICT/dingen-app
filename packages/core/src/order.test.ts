import { describe, expect, it } from 'vitest'
import { compareOrder, placeAt } from './order.js'

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
