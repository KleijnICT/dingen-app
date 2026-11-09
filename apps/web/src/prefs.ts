import { useSyncExternalStore } from 'react'

/**
 * Per-device choices that are not part of the data: how Today is ordered.
 * Stored in localStorage, like the language.
 */

export type TodayView = 'manual' | 'grouped'

const KEY = 'dingen.todayView'
const listeners = new Set<() => void>()

function read(): TodayView {
  try {
    return localStorage.getItem(KEY) === 'grouped' ? 'grouped' : 'manual'
  } catch {
    return 'manual'
  }
}

export function setTodayView(view: TodayView): void {
  try {
    if (view === 'manual') localStorage.removeItem(KEY)
    else localStorage.setItem(KEY, view)
  } catch {
    // Private windows may refuse storage; the choice then lasts until reload.
  }
  for (const l of listeners) l()
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener)
  return () => listeners.delete(listener)
}

export function useTodayView(): TodayView {
  return useSyncExternalStore(subscribe, read, () => 'manual')
}
