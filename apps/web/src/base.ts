/**
 * The path prefix the app runs under. Empty on a normal install; under Home Assistant ingress
 * something like `/api/hassio_ingress/<token>`. The server writes it into index.html as
 * `window.__DINGEN_BASE__` (apps/server/src/static.ts). Inside the app, paths stay `/today`,
 * `/api/...`; only the edges (fetch, address bar, links) add or strip the base.
 */

const BASE_PATTERN = /^(\/[A-Za-z0-9_.-]+)*$/

/** The base from a raw value; anything unexpected counts as the root. */
export function readBase(value: unknown): string {
  if (typeof value !== 'string') return ''
  const trimmed = value.replace(/\/+$/, '')
  return BASE_PATTERN.test(trimmed) ? trimmed : ''
}

/** The base of this page, read on every call (cheap, and easy to vary in tests). */
export function currentBase(): string {
  const w = (globalThis as { window?: { __DINGEN_BASE__?: unknown } }).window
  return readBase(w?.__DINGEN_BASE__)
}

/** True under a path prefix (ingress): no service worker, no web push, no manifest. */
export function underPrefix(base = currentBase()): boolean {
  return base !== ''
}

/** An app path (`/today`, `/api/sync/pull`) as the URL the browser needs. */
export function withBase(path: string, base = currentBase()): string {
  return path.startsWith('/') ? base + path : path
}

/** The app path for a browser pathname: the base comes off; the base itself is `/`. */
export function stripBase(pathname: string, base = currentBase()): string {
  if (!base) return pathname
  if (pathname === base) return '/'
  return pathname.startsWith(`${base}/`) ? pathname.slice(base.length) : pathname
}
