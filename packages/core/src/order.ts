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
  const before = siblings[index - 1]
  const after = siblings[index]
  const a = before ? key(before) : null
  const b = after ? key(after) : null
  if (a === null || b === null || a < b) {
    return { order: orderBetween(a, b), renumber: new Map() }
  }
  const orders = ordersBetween(null, null, siblings.length + 1)
  const renumber = new Map<string, string>()
  let moved = ''
  let i = 0
  for (let slot = 0; slot <= siblings.length; slot++) {
    const order = orders[slot] as string
    if (slot === index) {
      moved = order
      continue
    }
    const sibling = siblings[i++] as T
    if (key(sibling) !== order) renumber.set(sibling.id, order)
  }
  return { order: moved, renumber }
}
