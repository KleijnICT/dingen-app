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
