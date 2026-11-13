import {
  newTag,
  normalizeTagTitle,
  orderBetween,
  sameTagTitle,
  type Tag,
  views,
} from '@dingen/core'

/**
 * The tag a typed name stands for: an existing live tag with that name (case
 * and extra spaces do not count, for older tags with capitals), or a new one
 * with the lowercase name at the end of the list (plan 23). Null for a blank name.
 */
export function tagForName(tags: Tag[], typed: string): { tag: Tag; created: boolean } | null {
  const title = normalizeTagTitle(typed)
  if (!title) return null
  const existing = tags.find((x) => !x.deleted && sameTagTitle(x.title, title))
  if (existing) return { tag: existing, created: false }
  const last = [...tags].sort(views.byOrder).at(-1)
  return { tag: newTag({ title, order: orderBetween(last?.order ?? null, null) }), created: true }
}
