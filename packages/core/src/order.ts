import { generateKeyBetween, generateNKeysBetween } from 'fractional-indexing'

/**
 * Volgorde als string (fractional indexing). Een item tussen twee andere
 * plaatsen is één veldwijziging op dat item; andere items blijven onaangeroerd.
 */

export function orderBetween(before: string | null, after: string | null): string {
  return generateKeyBetween(before, after)
}

export function ordersBetween(before: string | null, after: string | null, n: number): string[] {
  return generateNKeysBetween(before, after, n)
}

export function firstOrder(): string {
  return generateKeyBetween(null, null)
}

export function compareOrder(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0
}

export interface Placement {
  /** The new order of the moved item. */
  order: string
  /** New orders for siblings, by id; empty unless the row had to be renumbered. */
  renumber: Map<string, string>
}

/**
 * Where an item lands at `index` among `siblings` (sorted, without the item).
 * Usually one key between the neighbours. When neighbours share an order or
 * are out of order (two imports, two devices), no key fits between them; then
 * the whole row is renumbered so the move still works.
 */
export function placeAt<T extends { id: string }>(
  siblings: readonly T[],
  index: number,
  key: (item: T) => string,
): Placement {
  const { orders, renumber } = placeBlockAt(siblings, index, 1, key)
  return { order: orders[0] as string, renumber }
}

export interface BlockPlacement {
  /** The new orders of the moved items, in the order they land. */
  orders: string[]
  /** New orders for siblings, by id; empty unless the row had to be renumbered. */
  renumber: Map<string, string>
}

/**
 * Where `count` items land together at `index` among `siblings` (sorted, without the items),
 * keeping their own order: like `placeAt`, but for a block (several selected tasks dragged
 * at once).
 */
export function placeBlockAt<T extends { id: string }>(
  siblings: readonly T[],
  index: number,
  count: number,
  key: (item: T) => string,
): BlockPlacement {
  const before = siblings[index - 1]
  const after = siblings[index]
  const a = before ? key(before) : null
  const b = after ? key(after) : null
  if (a === null || b === null || a < b) {
    return { orders: ordersBetween(a, b, count), renumber: new Map() }
  }
  const all = ordersBetween(null, null, siblings.length + count)
  const renumber = new Map<string, string>()
  siblings.forEach((sibling, i) => {
    const order = all[i < index ? i : i + count] as string
    if (key(sibling) !== order) renumber.set(sibling.id, order)
  })
  return { orders: all.slice(index, index + count), renumber }
}
