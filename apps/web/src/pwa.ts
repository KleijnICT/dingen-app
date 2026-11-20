import { useSyncExternalStore } from 'react'
import { underPrefix } from './base.js'
import { navigate } from './router.js'

/**
 * Registers the service worker and reports when a new version is waiting. The new worker
 * stays in "waiting" until the person chooses to reload, so a running edit is never lost.
 */

const CHECK_INTERVAL = 60 * 60 * 1000

let waiting: ServiceWorker | null = null
/** The server refused this version's sync protocol and a reload did not help (yet). */
let outdated = false
const listeners = new Set<() => void>()

function notify(): void {
  for (const l of listeners) l()
}

function setWaiting(worker: ServiceWorker | null): void {
  waiting = worker
  notify()
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

/**
 * Starts the service worker. Does nothing in development, where it is not supported, or under
 * a path prefix (ingress): the worker's scope is `/`, and that origin belongs to the proxy.
 */
export function registerServiceWorker(): void {
  if (!import.meta.env.PROD || !('serviceWorker' in navigator) || underPrefix()) return
  // A click on a notification about one task, while the app is open (sw/sw.js).
  navigator.serviceWorker.addEventListener('message', (event: MessageEvent) => {
    const data = event.data as { type?: unknown; path?: unknown } | null
    if (data?.type === 'OPEN_PATH' && typeof data.path === 'string' && data.path.startsWith('/')) {
      navigate(data.path)
    }
  })
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

/** When the app last reloaded because the server needs a newer version. */
const OUTDATED_RELOAD_KEY = 'dingen.outdatedReloadAt'
/** No second reload within this time: the new version is not there (yet); ask instead. */
const OUTDATED_RELOAD_PAUSE = 5 * 60 * 1000

/**
 * The server refuses this version's sync protocol (HTTP 426): a newer app is
 * on the server. Reload to get it, once; the page itself is fetched from the
 * network first (sw/sw.js), so a plain reload brings the new version. If the
 * app is still outdated after that, it does not loop but shows the update
 * notice instead.
 */
export function reloadForOutdated(now = Date.now()): void {
  let last = 0
  try {
    last = Number(sessionStorage.getItem(OUTDATED_RELOAD_KEY)) || 0
  } catch {
    // No storage: reload anyway, the pause below then never applies.
  }
  if (now - last < OUTDATED_RELOAD_PAUSE) {
    outdated = true
    notify()
    return
  }
  try {
    sessionStorage.setItem(OUTDATED_RELOAD_KEY, String(now))
  } catch {
    // See above.
  }
  reloadForUpdate()
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

/** True when the server needs a newer version and reloading did not bring it. */
export function useOutdated(): boolean {
  return useSyncExternalStore(
    subscribe,
    () => outdated,
    () => false,
  )
}
