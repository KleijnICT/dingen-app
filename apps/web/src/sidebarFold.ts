/**
 * Folding the sidebar to a rail of icons, kept free of React and the DOM so it can be tested:
 * which shape the sidebar takes, what the rail shows and how much room the resize handle has.
 */
import type { Area, Project } from '@dingen/core'
import { views } from '@dingen/core'
import { LISTS, type ListId } from './lists.js'
import { LIST_MIN } from './resize.js'

/** A drawer on phones, otherwise the full sidebar or the rail of icons. */
export type SidebarShape = 'drawer' | 'full' | 'rail'

export interface SidebarShapeInput {
  /** Phone width: the sidebar is a drawer, and never folds. */
  narrow: boolean
  /** On `/review`, where the rail is the default. */
  reviewing: boolean
  /** The user's own choice, kept per device. */
  collapsed: boolean
  /** In the review: the user unfolded the sidebar with the button. */
  reviewOpen: boolean
}

/**
 * The review folds the sidebar unless the user unfolds it there; everywhere else the user's
 * own choice counts. Navigating never changes it, only the button does.
 */
export function sidebarShape(s: SidebarShapeInput): SidebarShape {
  if (s.narrow) return 'drawer'
  if (s.reviewing) return s.reviewOpen ? 'full' : 'rail'
  return s.collapsed ? 'rail' : 'full'
}

export type RailEntry =
  | { kind: 'list'; id: ListId }
  | { kind: 'review' }
  | { kind: 'area'; area: Area }

/**
 * What the rail shows: the lists, with Review between Someday and Logbook, then the open
 * areas. No projects; they live in the full sidebar.
 */
export function railEntries(areas: Area[]): RailEntry[] {
  const out: RailEntry[] = []
  for (const list of LISTS) {
    if (list.id === 'logbook') out.push({ kind: 'review' })
    out.push({ kind: 'list', id: list.id })
  }
  for (const area of views.openAreas(areas)) out.push({ kind: 'area', area })
  return out
}

/** An area in the rail is lit on its own page and on the pages of its projects. */
export function railAreaActive(
  areaId: string,
  route: { kind: string; id?: string },
  projectById: Map<string, Project>,
): boolean {
  if (route.kind === 'area') return route.id === areaId
  if (route.kind === 'project' && route.id) return projectById.get(route.id)?.areaId === areaId
  return false
}

export interface SidebarRoomInput {
  shape: SidebarShape
  reviewing: boolean
  /** The window's width. */
  window: number
  /** A task panel open beside the list, or 0. */
  panel: number
  /** The rail's width. */
  rail: number
}

/**
 * The `room` for the sidebar's resize handle (see `maxWidth`): the window less what else sits
 * beside the list. In the review the handle sizes the review list, which sits beside the rail;
 * with the sidebar unfolded there, sidebar and review list share one width and grow together,
 * so each may take half of what the list leaves.
 */
export function sidebarRoom(s: SidebarRoomInput): number {
  const room = s.window - s.panel
  if (!s.reviewing) return room
  if (s.shape === 'rail') return room - s.rail
  return (room + LIST_MIN) / 2
}
