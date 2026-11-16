/**
 * The rules behind dragging the sidebar and the task panel wider or narrower, kept free of
 * React and the DOM so they can be tested: the limits, how far a drag or key press moves the
 * edge, and how much room the list in between must keep.
 */

export interface WidthLimits {
  min: number
  max: number
  default: number
}

export const SIDEBAR_LIMITS: WidthLimits = { min: 180, max: 360, default: 220 }
export const PANEL_LIMITS: WidthLimits = { min: 320, max: 640, default: 420 }

/** The list between sidebar and panel never gets narrower than this. */
export const LIST_MIN = 360

/** How far one arrow key press moves the edge; with Shift, a bigger step. */
export const KEY_STEP = 10
export const KEY_STEP_LARGE = 40

/** `width` rounded and kept within `min` and `max` (`min` wins when they cross). */
export function clampWidth(width: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, Math.round(width)))
}

/**
 * The widest this part may be: its own maximum, or less when the list would otherwise get
 * narrower than LIST_MIN. `room` is the window width minus whatever else sits beside the list.
 */
export function maxWidth(limits: WidthLimits, room: number): number {
  return Math.max(limits.min, Math.min(limits.max, Math.floor(room - LIST_MIN)))
}

/**
 * Which way the handle sits: on the right edge of the sidebar (dragging right makes it wider)
 * or on the left edge of the panel (dragging left makes it wider).
 */
export type Edge = 'right' | 'left'

/** The width after dragging the pointer `dx` pixels from where the drag started. */
export function dragWidth(start: number, dx: number, edge: Edge, min: number, max: number): number {
  return clampWidth(edge === 'right' ? start + dx : start - dx, min, max)
}

/**
 * The width after a key press on the handle, or null for keys it does not use. Arrows move
 * the edge the way they point, Home and End jump to the narrowest and widest.
 */
export function keyWidth(
  key: string,
  shift: boolean,
  width: number,
  edge: Edge,
  min: number,
  max: number,
): number | null {
  const step = shift ? KEY_STEP_LARGE : KEY_STEP
  switch (key) {
    case 'ArrowRight':
      return clampWidth(width + (edge === 'right' ? step : -step), min, max)
    case 'ArrowLeft':
      return clampWidth(width + (edge === 'right' ? -step : step), min, max)
    case 'Home':
      return min
    case 'End':
      return max
    default:
      return null
  }
}
