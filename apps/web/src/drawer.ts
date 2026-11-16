/** Pure rules for the sidebar drawer on narrow screens. */

/** Below this width the sidebar is a drawer; keep in step with the 720px media queries. */
export const NARROW_QUERY = '(max-width: 720px)'

/** A swipe that opens the drawer must start this close to the left screen edge. */
export const EDGE_WIDTH = 24

/** How far a finger must travel sideways before a swipe counts. */
export const SWIPE_DISTANCE = 56

export interface Point {
  x: number
  y: number
}

/** True when a touch starts on the left screen edge. */
export function startsAtEdge(x: number, edge = EDGE_WIDTH): boolean {
  return x >= 0 && x <= edge
}

/**
 * Which way a finger moved, if it was clearly sideways and far enough.
 * A mostly vertical move is scrolling, not a swipe.
 */
export function swipeDirection(
  start: Point,
  end: Point,
  distance = SWIPE_DISTANCE,
): 'left' | 'right' | null {
  const dx = end.x - start.x
  const dy = end.y - start.y
  if (Math.abs(dx) < distance) return null
  if (Math.abs(dy) > Math.abs(dx) / 2) return null
  return dx > 0 ? 'right' : 'left'
}

/**
 * What a finished touch does to the drawer: open it with a rightward swipe
 * from the left edge, close it with a leftward swipe while open.
 */
export function drawerSwipe(open: boolean, start: Point, end: Point): 'open' | 'close' | null {
  const direction = swipeDirection(start, end)
  if (!open && direction === 'right' && startsAtEdge(start.x)) return 'open'
  if (open && direction === 'left') return 'close'
  return null
}
