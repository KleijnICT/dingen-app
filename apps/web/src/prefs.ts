import { useSyncExternalStore } from 'react'
import { clampWidth, PANEL_LIMITS, SIDEBAR_LIMITS } from './resize.js'

/**
 * Per-device choices that are not part of the data: how Today is ordered,
 * how wide the sidebar and the task panel are, whether the sidebar is folded to
 * a rail and which areas are folded shut.
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

/** Sidebar and panel widths in pixels; dragged by the user, kept per device. */
const WIDTH_KEYS = { sidebar: 'dingen.sidebarWidth', panel: 'dingen.panelWidth' } as const
const WIDTH_LIMITS = { sidebar: SIDEBAR_LIMITS, panel: PANEL_LIMITS } as const
export type Resizable = keyof typeof WIDTH_KEYS

function readWidth(part: Resizable): number {
  const { min, max, default: fallback } = WIDTH_LIMITS[part]
  try {
    const stored = Number(localStorage.getItem(WIDTH_KEYS[part]))
    return stored > 0 ? clampWidth(stored, min, max) : fallback
  } catch {
    return fallback
  }
}
const readSidebarWidth = () => readWidth('sidebar')
const readPanelWidth = () => readWidth('panel')

/** `null` puts the default width back. */
export function setWidth(part: Resizable, width: number | null): void {
  const { min, max } = WIDTH_LIMITS[part]
  try {
    if (width === null) localStorage.removeItem(WIDTH_KEYS[part])
    else localStorage.setItem(WIDTH_KEYS[part], String(clampWidth(width, min, max)))
  } catch {
    // See setTodayView.
  }
  for (const l of listeners) l()
}

export function useSidebarWidth(): number {
  return useSyncExternalStore(subscribe, readSidebarWidth, () => SIDEBAR_LIMITS.default)
}

export function usePanelWidth(): number {
  return useSyncExternalStore(subscribe, readPanelWidth, () => PANEL_LIMITS.default)
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

/**
 * Completed sections (in a project or area) that are folded open, as a
 * comma-separated list of keys like `project:<id>`. Folded shut by default.
 */
const COMPLETED_KEY = 'dingen.completedOpen'

function readCompletedOpen(): string {
  try {
    return localStorage.getItem(COMPLETED_KEY) ?? ''
  } catch {
    return ''
  }
}

export function toggleCompletedOpen(key: string): void {
  const keys = new Set(readCompletedOpen().split(',').filter(Boolean))
  if (!keys.delete(key)) keys.add(key)
  try {
    if (keys.size === 0) localStorage.removeItem(COMPLETED_KEY)
    else localStorage.setItem(COMPLETED_KEY, [...keys].join(','))
  } catch {
    // See setTodayView.
  }
  for (const l of listeners) l()
}

export function useCompletedOpen(key: string): boolean {
  const raw = useSyncExternalStore(subscribe, readCompletedOpen, () => '')
  return raw.split(',').includes(key)
}

/** Focus mode in Today: only the day's tasks, no sidebar. Kept per device. */
const FOCUS_KEY = 'dingen.focusMode'

function readFocus(): boolean {
  try {
    return localStorage.getItem(FOCUS_KEY) === '1'
  } catch {
    return false
  }
}

export function setFocusMode(on: boolean): void {
  try {
    if (on) localStorage.setItem(FOCUS_KEY, '1')
    else localStorage.removeItem(FOCUS_KEY)
  } catch {
    // Private windows may refuse storage; the choice then lasts until reload.
  }
  for (const l of listeners) l()
}

export function useFocusMode(): boolean {
  return useSyncExternalStore(subscribe, readFocus, () => false)
}

/** The sidebar folded to a rail of icons on a desktop. Kept per device; only its button changes it. */
const SIDEBAR_COLLAPSED_KEY = 'dingen.sidebarCollapsed'
/** The choice in memory, for windows that refuse storage. */
let sidebarCollapsed = false

function readSidebarCollapsed(): boolean {
  try {
    return localStorage.getItem(SIDEBAR_COLLAPSED_KEY) === '1'
  } catch {
    return sidebarCollapsed
  }
}

export function setSidebarCollapsed(collapsed: boolean): void {
  sidebarCollapsed = collapsed
  try {
    if (collapsed) localStorage.setItem(SIDEBAR_COLLAPSED_KEY, '1')
    else localStorage.removeItem(SIDEBAR_COLLAPSED_KEY)
  } catch {
    // Private windows may refuse storage; the choice then lasts until reload.
  }
  for (const l of listeners) l()
}

export function useSidebarCollapsed(): boolean {
  return useSyncExternalStore(subscribe, readSidebarCollapsed, () => false)
}
