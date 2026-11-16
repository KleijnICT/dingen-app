/**
 * Selecting several tasks at once, kept free of React and the DOM so it can be tested.
 * A selection is a set of task ids with an anchor (where a Shift range starts) and a focus
 * (the row the arrow keys move from). `order` is always the ids as they appear on screen.
 */

export interface Selection {
  /** The selected ids, in the order they appear on screen when that is known. */
  ids: string[]
  /** Where a Shift-click or Shift+Arrow range starts. */
  anchor: string | null
  /** The row last clicked or reached with the keys. */
  focus: string | null
}

export const EMPTY_SELECTION: Selection = { ids: [], anchor: null, focus: null }

/** Just this task (or nothing). */
export function selectOne(id: string | null): Selection {
  return id ? { ids: [id], anchor: id, focus: id } : EMPTY_SELECTION
}

/** Adds the task, or takes it out when it was already selected (Cmd/Ctrl-click, a tap). */
export function toggleInSelection(sel: Selection, id: string, order: readonly string[]): Selection {
  if (sel.ids.includes(id)) {
    const ids = sel.ids.filter((x) => x !== id)
    const last = ids.at(-1) ?? null
    return {
      ids,
      anchor: sel.anchor === id ? last : sel.anchor,
      focus: sel.focus === id ? last : sel.focus,
    }
  }
  return { ids: inOrder([...sel.ids, id], order), anchor: id, focus: id }
}

/**
 * Everything from the anchor to `id` in screen order (Shift-click); the anchor stays. Without
 * an anchor on screen it is just `id`.
 */
export function selectRange(sel: Selection, id: string, order: readonly string[]): Selection {
  const from = sel.anchor ? order.indexOf(sel.anchor) : -1
  const to = order.indexOf(id)
  if (from === -1 || to === -1) return selectOne(id)
  const [a, b] = from <= to ? [from, to] : [to, from]
  return { ids: order.slice(a, b + 1), anchor: sel.anchor, focus: id }
}

/**
 * Shift+Arrow: the focus moves one row up or down and the selection becomes the range from
 * the anchor to it. Without a selection it starts at the top (down) or the bottom (up).
 * Null when nothing changes (at the end of the list, or an empty list).
 */
export function extendSelection(
  sel: Selection,
  direction: 'up' | 'down',
  order: readonly string[],
): Selection | null {
  if (order.length === 0) return null
  const at = sel.focus ? order.indexOf(sel.focus) : -1
  if (at === -1) {
    const start = direction === 'down' ? order[0] : order[order.length - 1]
    return start ? selectOne(start) : null
  }
  const next = order[direction === 'down' ? at + 1 : at - 1]
  if (!next) return null
  const anchored = sel.anchor && order.includes(sel.anchor) ? sel : { ...sel, anchor: sel.focus }
  return selectRange(anchored, next, order)
}

/**
 * Without the tasks that are gone (deleted, finished and off the list, filtered out). The
 * anchor and focus fall back to the last remaining one. Returns `sel` itself when nothing
 * changes.
 */
export function pruneSelection(sel: Selection, present: ReadonlySet<string>): Selection {
  if (sel.ids.every((id) => present.has(id))) return sel
  const ids = sel.ids.filter((id) => present.has(id))
  const last = ids.at(-1) ?? null
  const keep = (x: string | null) => (x && present.has(x) ? x : last)
  return { ids, anchor: keep(sel.anchor), focus: keep(sel.focus) }
}

/**
 * The row to select after the selected ones are deleted: the first one below the last
 * selected that is not itself selected, or else the nearest one above.
 */
export function nextAfterRemoval(ids: readonly string[], order: readonly string[]): string | null {
  const gone = new Set(ids)
  const positions = ids.map((id) => order.indexOf(id)).filter((i) => i !== -1)
  if (positions.length === 0) return null
  const last = Math.max(...positions)
  const first = Math.min(...positions)
  const stays = (id: string) => !gone.has(id)
  const below = order.slice(last + 1).find(stays)
  const above = order.slice(0, first).findLast(stays)
  return below ?? above ?? null
}

/** Whether all, some or none of the tasks carry the tag (the Tags button for a selection). */
export function tagCoverage(
  tasks: readonly { tagIds: readonly string[] }[],
  tagId: string,
): 'all' | 'some' | 'none' {
  const n = tasks.filter((t) => t.tagIds.includes(tagId)).length
  return n === 0 ? 'none' : n === tasks.length ? 'all' : 'some'
}

/**
 * The tag changes for each task when a tag is chosen for a selection: when all of them carry
 * it, it comes off all of them; otherwise the ones without it get it. Tasks that stay the same
 * are left out.
 */
export function tagChanges<T extends { id: string; tagIds: readonly string[] }>(
  tasks: readonly T[],
  tagId: string,
): { task: T; tagIds: string[] }[] {
  const remove = tagCoverage(tasks, tagId) === 'all'
  return tasks.flatMap((task) => {
    const has = task.tagIds.includes(tagId)
    if (remove) return [{ task, tagIds: task.tagIds.filter((id) => id !== tagId) }]
    return has ? [] : [{ task, tagIds: [...task.tagIds, tagId] }]
  })
}

/** `ids` sorted by their place in `order`; ids not on screen go last, in their own order. */
function inOrder(ids: string[], order: readonly string[]): string[] {
  const at = (id: string) => {
    const i = order.indexOf(id)
    return i === -1 ? Number.MAX_SAFE_INTEGER : i
  }
  return [...ids].sort((a, b) => at(a) - at(b))
}
