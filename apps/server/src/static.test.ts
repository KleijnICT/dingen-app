import { describe, expect, it } from 'vitest'
import { staticHeaders } from './static.js'

describe('staticHeaders', () => {
  it('never caches the service worker for long', () => {
    expect(staticHeaders('/sw.js')['Cache-Control']).toBe('no-cache')
  })

  it('revalidates index.html and the SPA routes', () => {
    expect(staticHeaders('/index.html')['Cache-Control']).toBe('no-cache')
    expect(staticHeaders('/today')['Cache-Control']).toBe('no-cache')
  })

  it('serves the manifest with its own content type', () => {
    const h = staticHeaders('/manifest.webmanifest')
    expect(h['Cache-Control']).toBe('no-cache')
    expect(h['Content-Type']).toBe('application/manifest+json')
  })

  it('caches hashed assets for a year', () => {
    expect(staticHeaders('/assets/index-abc123.js')['Cache-Control']).toContain('immutable')
  })
})
