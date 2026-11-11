import { useSyncExternalStore } from 'react'

/**
 * Registers the service worker and reports when a new version is waiting. The new worker
 * stays in "waiting" until the person chooses to reload, so a running edit is never lost.
 */

const CHECK_INTERVAL = 60 * 60 * 1000

let waiting: ServiceWorker | null = null
const listeners = new Set<() => void>()

function setWaiting(worker: ServiceWorker | null): void {
  waiting = worker
  for (const l of listeners) l()
}

function watch(reg: ServiceWorkerRegistration): void {
  // A worker that was already waiting when the page loaded (a previous visit found an update).
  if (reg.waiting && navigator.serviceWorker.controller) setWaiting(reg.waiting)
  reg.addEventListener('updatefound', () => {
    const installing = reg.installing
    installing?.addEventListener('statechange', () => {
      if (installing.state === 'installed' && navigator.serviceWorker.controller) {
        setWaiting(installing)
      }
    })
  })
}

/** Starts the service worker. Does nothing in development or where it is not supported. */
export function registerServiceWorker(): void {
  if (!import.meta.env.PROD || !('serviceWorker' in navigator)) return
  window.addEventListener('load', () => {
    navigator.serviceWorker
      .register('/sw.js')
      .then((reg) => {
        watch(reg)
        setInterval(() => void reg.update().catch(() => {}), CHECK_INTERVAL)
      })
      .catch(() => {})
  })
}

/** Activates the waiting worker and reloads once it has taken over. */
export function reloadForUpdate(): void {
  if (!waiting) {
    window.location.reload()
    return
  }
  navigator.serviceWorker.addEventListener('controllerchange', () => window.location.reload(), {
    once: true,
  })
  waiting.postMessage({ type: 'SKIP_WAITING' })
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener)
  return () => listeners.delete(listener)
}

/** True when a new version has been downloaded and is waiting for a reload. */
export function useUpdateAvailable(): boolean {
  return useSyncExternalStore(
    subscribe,
    () => waiting !== null,
    () => false,
  )
}
