/**
 * The rules behind the task panel, kept free of React and the DOM so they can be tested:
 * how the panel sits next to the list at a given width, and what a key press in a task list
 * does.
 */

/** Beside the list (wide), over the list with a scrim (medium), or the whole screen (phone). */
export type PanelMode = 'side' | 'overlay' | 'full'

export const SIDE_FROM = 1200
export const OVERLAY_FROM = 720

export function panelMode(width: number): PanelMode {
  if (width >= SIDE_FROM) return 'side'
  if (width >= OVERLAY_FROM) return 'overlay'
  return 'full'
}

export interface KeyInput {
  key: string
  /** Cmd, Ctrl or Alt is held. */
  modified: boolean
  /** Focus is in a text field or select. */
  typing: boolean
  /** Focus is in a popup or menu (or another window such as Search). */
  inPopup: boolean
  /** Focus is somewhere inside the panel, but not on the panel itself. */
  inPanel: boolean
  /** Focus is on the panel element itself (right after it opened). */
  onPanel: boolean
  /** Focus is in the list itself (a row), not on the page around it. */
  inList: boolean
  /** Focus is on a button or link, which Enter already presses. */
  onButton: boolean
  selected: string | null
  open: string | null
  /** The task ids in the order they appear on screen. */
  ids: string[]
}

export type KeyAction =
  | { kind: 'move'; id: string }
  | { kind: 'open'; id: string }
  | { kind: 'close' }
  | { kind: 'deselect' }
  | { kind: 'delete'; id: string; next: string | null }
  | null

/**
 * What a key does in a task list. Arrows move the selection (an open panel follows), Enter
 * opens the panel, Escape closes it (the selection stays) or else clears the selection, and
 * Backspace or Delete removes the selected task (with the panel open, only from the list).
 * Typing in the panel only reacts to Escape.
 */
export function listKeyAction(k: KeyInput): KeyAction {
  if (k.modified || k.inPopup) return null
  if (k.typing || k.inPanel) {
    return k.key === 'Escape' && k.inPanel && k.open ? { kind: 'close' } : null
  }
  switch (k.key) {
    case 'Escape':
      if (k.open) return { kind: 'close' }
      return k.selected ? { kind: 'deselect' } : null
    case 'Enter':
      return k.selected && !k.open && !k.onButton ? { kind: 'open', id: k.selected } : null
    case 'Backspace':
    case 'Delete': {
      // With the panel open, only from the list: the open task should not vanish by accident.
      if (!k.selected || k.onPanel || (k.open && !k.inList)) return null
      const at = k.ids.indexOf(k.selected)
      if (at === -1) return null
      return { kind: 'delete', id: k.selected, next: k.ids[at + 1] ?? k.ids[at - 1] ?? null }
    }
    case 'ArrowDown':
    case 'ArrowUp': {
      if (k.ids.length === 0) return null
      const at = k.selected ? k.ids.indexOf(k.selected) : -1
      const next =
        k.key === 'ArrowDown'
          ? k.ids[Math.min(k.ids.length - 1, at + 1)]
          : k.ids[Math.max(0, at - 1)]
      return next && next !== k.selected ? { kind: 'move', id: next } : null
    }
    default:
      return null
  }
}

/** The query string with `?task=` set to `id`, or without it for null; other parameters stay. */
export function withTaskParam(search: string, id: string | null): string {
  const params = new URLSearchParams(search)
  if (id) params.set('task', id)
  else params.delete('task')
  const s = params.toString()
  return s ? `?${s}` : ''
}

/** The task in `?task=`, if any. */
export function taskParamOf(search: string): string | null {
  return new URLSearchParams(search).get('task') || null
}
