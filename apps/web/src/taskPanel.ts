/**
 * The rules behind the task panel, kept free of React and the DOM so they can be tested:
 * how the panel sits next to the list at a given width, and what a key press in a task list
 * does, and which of a task's fields the panel shows.
 */

import type { Task } from '@dingen/core'

/** Beside the list (wide), over the list with a scrim (medium), or the whole screen (phone). */
export type PanelMode = 'side' | 'overlay' | 'full'

/**
 * What a click on a task row does. With a mouse it only selects, so the toolbar's When and
 * Move can act on it; a double click opens the panel. On a touch screen a tap opens. When the
 * panel is already open, a click shows the clicked task in it.
 */
export function rowClickAction(coarsePointer: boolean, panelOpen: boolean): 'open' | 'select' {
  return coarsePointer || panelOpen ? 'open' : 'select'
}

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

/** The fields of the panel that only show with a value (or right after adding one). */
export type OptionalField = 'time' | 'deadline' | 'repeat' | 'assignee'

/** In the order of the Add row: planning first, then organization. */
export const OPTIONAL_FIELDS: readonly OptionalField[] = ['time', 'deadline', 'repeat', 'assignee']

type FieldTask = Pick<
  Task,
  'status' | 'when' | 'time' | 'reminder' | 'deadline' | 'templateId' | 'assigneeId'
>

/** Whether each optional field has a value. */
export function fieldValues(task: FieldTask): Record<OptionalField, boolean> {
  return {
    time: task.time !== null || task.reminder !== null,
    deadline: task.deadline !== null,
    repeat: task.templateId !== null,
    assignee: task.assigneeId !== null,
  }
}

export interface FieldLayout {
  /** Fields shown in their section. */
  shown: OptionalField[]
  /** Fields offered in the Add row. */
  addable: OptionalField[]
}

/**
 * Which optional fields the panel shows and which it offers to add. A field shows when it has
 * a value or was just added (`added`), as long as it can apply: a time needs a date, assigning
 * needs someone to assign to (`canAssign`), and only an open task can start repeating.
 */
export function fieldLayout(
  task: FieldTask,
  added: readonly OptionalField[],
  canAssign: boolean,
): FieldLayout {
  const values = fieldValues(task)
  const applies: Record<OptionalField, boolean> = {
    time: task.when.kind === 'date',
    deadline: true,
    repeat: task.status === 'open' || values.repeat,
    assignee: canAssign || values.assignee,
  }
  const shown = OPTIONAL_FIELDS.filter((f) => applies[f] && (values[f] || added.includes(f)))
  const addable = OPTIONAL_FIELDS.filter((f) => applies[f] && !shown.includes(f))
  return { shown, addable }
}

/** The added fields still waiting for a value; one that got its value is no longer "added". */
export function stillAdded(task: FieldTask, added: readonly OptionalField[]): OptionalField[] {
  const values = fieldValues(task)
  return added.filter((f) => !values[f])
}

/** How far a checklist is: its done items out of all of them, for the "1 of 4" in its heading. */
export function checklistProgress(items: readonly { done: boolean }[]): {
  done: number
  total: number
} {
  return { done: items.filter((i) => i.done).length, total: items.length }
}
