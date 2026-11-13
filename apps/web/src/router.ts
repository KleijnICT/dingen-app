import { useSyncExternalStore } from 'react'
import { stripBase, withBase } from './base.js'

/**
 * Routing in a few lines: the path in the address bar, no library. App paths (`/today`) never
 * carry the base path; navigate and usePath add and strip it (base.ts).
 */

const listeners = new Set<() => void>()

export function navigate(path: string): void {
  const url = withBase(path)
  if (window.location.pathname === url) return
  window.history.pushState(null, '', url)
  for (const l of listeners) l()
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener)
  window.addEventListener('popstate', listener)
  return () => {
    listeners.delete(listener)
    window.removeEventListener('popstate', listener)
  }
}

export function usePath(): string {
  return useSyncExternalStore(subscribe, currentPath)
}

/** The app path of the address bar, without the base. */
export function currentPath(): string {
  return stripBase(window.location.pathname)
}

/** The href for a link to an app path (for open-in-new-tab; clicks go through navigate). */
export const appHref = (path: string): string => withBase(path)

export type Route =
  | { kind: 'list'; path: string }
  | { kind: 'project'; id: string }
  | { kind: 'area'; id: string }
  | { kind: 'account' }
  | { kind: 'review'; reviewKind: string | null }

export function parseRoute(path: string): Route {
  const project = path.match(/^\/project\/([A-Za-z0-9]+)$/)
  if (project?.[1]) return { kind: 'project', id: project[1] }
  const area = path.match(/^\/area\/([A-Za-z0-9]+)$/)
  if (area?.[1]) return { kind: 'area', id: area[1] }
  if (path === '/account') return { kind: 'account' }
  const review = path.match(/^\/review(?:\/([a-z]+))?$/)
  if (review) return { kind: 'review', reviewKind: review[1] ?? null }
  return { kind: 'list', path }
}

export const projectPath = (id: string) => `/project/${id}`
export const areaPath = (id: string) => `/area/${id}`
