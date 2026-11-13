/**
 * Tag names (plan 23, decision 4b): always lowercase, also when someone types
 * capitals. Every place that creates or renames a tag goes through
 * `normalizeTagTitle`; matching a typed name against existing tags goes
 * through `sameTagTitle`, so it stays case-insensitive for older data.
 */

/** Trims, collapses inner whitespace to one space and lowercases (Dutch rules). */
export function normalizeTagTitle(title: string): string {
  return title.trim().replace(/\s+/g, ' ').toLocaleLowerCase('nl')
}

/** Do two tag titles name the same tag? Case and extra spaces do not count. */
export function sameTagTitle(a: string, b: string): boolean {
  return normalizeTagTitle(a) === normalizeTagTitle(b)
}
