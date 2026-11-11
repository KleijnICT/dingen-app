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
