import type { Snapshot, Writer } from './actions.js'
import type { Tag } from './entities.js'
import { newTag } from './factories.js'
import { orderBetween } from './order.js'
import { normalizeTagTitle, sameTagTitle } from './tags.js'
import * as views from './views.js'

/**
 * Managing tags in Settings: the tags as a tree, which parents a tag may get,
 * and the checks and writes for creating, renaming and deleting. Pure: the
 * space of a tag comes in as a function, the writes go through a `Writer`.
 *
 * A tag's space is only known once the server placed it; `null` means not
 * known yet (a new tag that has not synced). Such a tag counts as being in
 * every space, so the checks stay on the safe side.
 */
export type SpaceOf = (tag: Tag) => string | null

export interface TagNode {
  tag: Tag
  /** 0 for a top-level tag, 1 for its children, and so on. */
  depth: number
}

/** Can these two tags be in the same space? */
function sameSpace(spaceOf: SpaceOf, a: Tag, b: Tag): boolean {
  const x = spaceOf(a)
  const y = spaceOf(b)
  return x === null || y === null || x === y
}

/**
 * The live tags as a flat list in tree order: each tag followed by its
 * children (in `order`), indented by `depth`. A tag whose parent is gone, or
 * that sits in a loop of parents, shows at the top level.
 */
export function tagTree(tags: readonly Tag[]): TagNode[] {
  const live = tags.filter((t) => !t.deleted).sort(views.byOrder)
  const ids = new Set(live.map((t) => t.id))
  const children = new Map<string | null, Tag[]>()
  for (const tag of live) {
    const parent = tag.parentId && ids.has(tag.parentId) ? tag.parentId : null
    children.set(parent, [...(children.get(parent) ?? []), tag])
  }
  const out: TagNode[] = []
  const seen = new Set<string>()
  const walk = (parent: string | null, depth: number) => {
    for (const tag of children.get(parent) ?? []) {
      if (seen.has(tag.id)) continue
      seen.add(tag.id)
      out.push({ tag, depth })
      walk(tag.id, depth + 1)
    }
  }
  walk(null, 0)
  // Tags in a loop of parents are never reached from the top: show them there.
  for (const tag of live) {
    if (seen.has(tag.id)) continue
    seen.add(tag.id)
    out.push({ tag, depth: 0 })
    walk(tag.id, 1)
  }
  return out
}

/** The ids of every tag below this one (children, their children, …). */
export function descendantIds(tags: readonly Tag[], id: string): Set<string> {
  const out = new Set<string>()
  const stack = [id]
  while (stack.length > 0) {
    const current = stack.pop()
    for (const tag of tags) {
      if (tag.deleted || tag.parentId !== current || out.has(tag.id) || tag.id === id) continue
      out.add(tag.id)
      stack.push(tag.id)
    }
  }
  return out
}

/**
 * The tags this tag can move under, in tree order: live tags in the same
 * space, not the tag itself and not one of its own descendants.
 */
export function validParents(tags: readonly Tag[], tag: Tag, spaceOf: SpaceOf): TagNode[] {
  const below = descendantIds(tags, tag.id)
  return tagTree(tags).filter(
    (n) => n.tag.id !== tag.id && !below.has(n.tag.id) && sameSpace(spaceOf, n.tag, tag),
  )
}

export type NameIssue = 'empty' | 'taken'

/**
 * Why `typed` cannot be the name of `tag` (or of a new tag in the personal
 * space when `tag` is null): blank, or another live tag in the same space
 * already has that name. Null when it is fine.
 */
export function nameIssue(
  tags: readonly Tag[],
  tag: Tag | null,
  typed: string,
  spaceOf: SpaceOf,
): NameIssue | null {
  const title = normalizeTagTitle(typed)
  if (!title) return 'empty'
  const clash = tags.some(
    (other) =>
      !other.deleted &&
      other.id !== tag?.id &&
      sameTagTitle(other.title, title) &&
      (tag === null || sameSpace(spaceOf, other, tag)),
  )
  return clash ? 'taken' : null
}

/** A new top-level tag with the lowercase name, at the end of the list. */
export function makeTag(tags: readonly Tag[], typed: string): Tag {
  const last = [...tags].sort(views.byOrder).at(-1)
  return newTag({
    title: normalizeTagTitle(typed),
    order: orderBetween(last?.order ?? null, null),
  })
}

/** Open tasks (not done, not a repeat template) per tag id. */
export function openTaskCounts(tasks: Snapshot['tasks']): Map<string, number> {
  const out = new Map<string, number>()
  for (const task of tasks) {
    if (!views.isOpen(task)) continue
    for (const id of new Set(task.tagIds)) out.set(id, (out.get(id) ?? 0) + 1)
  }
  return out
}

/**
 * Deletes a tag: it comes off every task and project that has it (they stay),
 * its children move to the top level, and then the tag itself is deleted.
 */
export function deleteTag(
  writer: Writer,
  ws: Pick<Snapshot, 'tasks' | 'projects' | 'tags'>,
  tagId: string,
): void {
  for (const task of ws.tasks) {
    if (task.tagIds.includes(tagId)) {
      writer.mutate('task', task.id, { tagIds: task.tagIds.filter((id) => id !== tagId) })
    }
  }
  for (const project of ws.projects) {
    if (project.tagIds.includes(tagId)) {
      writer.mutate('project', project.id, {
        tagIds: project.tagIds.filter((id) => id !== tagId),
      })
    }
  }
  for (const child of ws.tags) {
    if (!child.deleted && child.parentId === tagId) {
      writer.mutate('tag', child.id, { parentId: null })
    }
  }
  writer.mutate('tag', tagId, { deleted: true })
}
