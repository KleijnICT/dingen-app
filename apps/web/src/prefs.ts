import { useSyncExternalStore } from 'react'

/**
 * Per-device choices that are not part of the data: how Today is ordered,
 * how wide the sidebar is and which areas are folded shut.
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

/** Sidebar width in pixels; dragged by the user, kept per device. */
export const SIDEBAR_DEFAULT = 220
export const SIDEBAR_MIN = 160
export const SIDEBAR_MAX = 480
const WIDTH_KEY = 'dingen.sidebarWidth'

export function clampSidebar(width: number): number {
  return Math.min(SIDEBAR_MAX, Math.max(SIDEBAR_MIN, Math.round(width)))
}

function readWidth(): number {
  try {
    const stored = Number(localStorage.getItem(WIDTH_KEY))
    return stored > 0 ? clampSidebar(stored) : SIDEBAR_DEFAULT
  } catch {
    return SIDEBAR_DEFAULT
  }
}

/** `null` puts the default width back. */
export function setSidebarWidth(width: number | null): void {
  try {
    if (width === null) localStorage.removeItem(WIDTH_KEY)
    else localStorage.setItem(WIDTH_KEY, String(clampSidebar(width)))
  } catch {
    // See setTodayView.
  }
  for (const l of listeners) l()
}

export function useSidebarWidth(): number {
  return useSyncExternalStore(subscribe, readWidth, () => SIDEBAR_DEFAULT)
}

/** Areas folded shut in the sidebar, as a comma-separated list of ids. */
const COLLAPSED_KEY = 'dingen.collapsedAreas'

function readCollapsed(): string {
  try {
    return localStorage.getItem(COLLAPSED_KEY) ?? ''
  } catch {
    return ''
  }
}

export function toggleAreaCollapsed(areaId: string): void {
  const ids = new Set(readCollapsed().split(',').filter(Boolean))
  if (!ids.delete(areaId)) ids.add(areaId)
  try {
    if (ids.size === 0) localStorage.removeItem(COLLAPSED_KEY)
    else localStorage.setItem(COLLAPSED_KEY, [...ids].join(','))
  } catch {
    // See setTodayView.
  }
  for (const l of listeners) l()
}

export function useCollapsedAreas(): Set<string> {
  const raw = useSyncExternalStore(subscribe, readCollapsed, () => '')
  return new Set(raw.split(',').filter(Boolean))
}
