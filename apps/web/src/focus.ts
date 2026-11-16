/** What a key press means for Today's focus mode. */
export interface FocusKeyInput {
  key: string
  modified: boolean
  /** Already used by something else (the task panel, a field, a popup). */
  handled: boolean
  typing: boolean
  inPopup: boolean
  inPanel: boolean
  onToday: boolean
  on: boolean
}

/** F toggles focus mode on Today; Escape turns it off when nothing else wants the key. */
export function focusKeyAction(k: FocusKeyInput): 'toggle' | 'off' | null {
  if (!k.onToday || k.modified || k.handled || k.typing || k.inPopup || k.inPanel) return null
  if (k.key === 'f' || k.key === 'F') return 'toggle'
  if (k.key === 'Escape' && k.on) return 'off'
  return null
}

/** Focus mode counts on Today only; elsewhere the sidebar is back. */
export function focusActive(on: boolean, listId: string | undefined): boolean {
  return on && listId === 'today'
}
