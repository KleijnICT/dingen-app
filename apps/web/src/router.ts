import { useSyncExternalStore } from 'react'

/** Routering in een paar regels: pad in de adresbalk, zonder bibliotheek. */

const listeners = new Set<() => void>()

export function navigate(path: string): void {
  if (window.location.pathname === path) return
  window.history.pushState(null, '', path)
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
  return useSyncExternalStore(subscribe, () => window.location.pathname)
}
