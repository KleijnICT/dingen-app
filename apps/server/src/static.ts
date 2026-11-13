import fs from 'node:fs'
import path from 'node:path'
import { serveStatic } from '@hono/node-server/serve-static'
import type { Context, Hono } from 'hono'
import type { AppEnv } from './env.js'

/**
 * Cache headers for the web build. The service worker, the manifest and index.html must
 * always be revalidated (a stale sw.js would block updates); hashed bundles never change
 * and may be cached for a year.
 */
export function staticHeaders(urlPath: string): Record<string, string> {
  if (urlPath.startsWith('/assets/')) {
    return { 'Cache-Control': 'public, max-age=31536000, immutable' }
  }
  if (urlPath === '/manifest.webmanifest') {
    return { 'Cache-Control': 'no-cache', 'Content-Type': 'application/manifest+json' }
  }
  // sw.js, index.html (also the SPA fallback), icons: revalidate on every load.
  return { 'Cache-Control': 'no-cache' }
}

/** A path prefix the web app may run under: segments of safe characters, no trailing slash. */
const BASE_PATTERN = /^(\/[A-Za-z0-9_.-]+)*$/

/**
 * The base path for this request, from the `ingressPath` context variable (set by the
 * ingress listener, e.g. `/api/hassio_ingress/<token>`). Empty means the root; anything
 * unexpected falls back to the root as well.
 */
export function basePath(ingressPath: string | undefined): string {
  if (!ingressPath) return ''
  const trimmed = ingressPath.replace(/\/+$/, '')
  return BASE_PATTERN.test(trimmed) ? trimmed : ''
}

/**
 * index.html for a base path: a `<base href>` so the relative asset URLs of the build resolve
 * from any depth, and `window.__DINGEN_BASE__` for the app's own URLs (API, router). Under a
 * prefix (ingress) the manifest link goes: no PWA there.
 */
export function renderIndex(html: string, base: string): string {
  const safe = BASE_PATTERN.test(base) ? base : ''
  const value = JSON.stringify(safe).replace(/</g, '\\u003c')
  const head = `<base href="${safe}/" /><script>window.__DINGEN_BASE__ = ${value}</script>`
  let out = html.replace(/<head>/i, (m) => `${m}\n    ${head}`)
  if (safe) out = out.replace(/\s*<link rel="manifest"[^>]*>/i, '')
  return out
}

/**
 * Serves the web build from `dir`: index.html (directly, as `/` and as the SPA fallback) with
 * the base path filled in, and every other file as is.
 */
export function mountWeb(app: Hono<AppEnv>, dir: string): void {
  // serveStatic works with paths relative to the current working directory.
  const root = path.relative(process.cwd(), dir) || '.'
  const html = fs.readFileSync(path.join(dir, 'index.html'), 'utf8')
  const files = serveStatic({ root })
  const index = (c: Context<AppEnv>) => {
    c.header('Cache-Control', 'no-cache')
    return c.html(renderIndex(html, basePath(c.get('ingressPath'))))
  }
  app.get('/', index)
  app.get('/index.html', index)
  app.use('/*', (c, next) => {
    // Set before serving: serveStatic's onFound runs after the response is built, too late.
    // A miss falls through to the index below, which sets its own Cache-Control.
    for (const [name, value] of Object.entries(staticHeaders(c.req.path))) c.header(name, value)
    return files(c, next)
  })
  app.get('/*', index)
}
