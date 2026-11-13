import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { Hono } from 'hono'
import { afterAll, describe, expect, it } from 'vitest'
import type { AppEnv } from './env.js'
import { basePath, mountWeb, renderIndex, staticHeaders } from './static.js'

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

describe('basePath', () => {
  it('is the root without an ingress path', () => {
    expect(basePath(undefined)).toBe('')
    expect(basePath('')).toBe('')
    expect(basePath('/')).toBe('')
  })

  it('keeps a valid prefix without its trailing slash', () => {
    expect(basePath('/api/hassio_ingress/abc-123_X')).toBe('/api/hassio_ingress/abc-123_X')
    expect(basePath('/api/hassio_ingress/abc/')).toBe('/api/hassio_ingress/abc')
  })

  it('falls back to the root for anything unexpected', () => {
    expect(basePath('/a/"><script>')).toBe('')
    expect(basePath('relative/path')).toBe('')
    expect(basePath('//evil.example')).toBe('')
  })
})

describe('renderIndex', () => {
  const html =
    '<!doctype html><html><head>\n<link rel="manifest" href="./manifest.webmanifest" />\n<title>Dingen</title></head><body></body></html>'

  it('sets the root base and keeps the manifest', () => {
    const out = renderIndex(html, '')
    expect(out).toContain('<base href="/" />')
    expect(out).toContain('window.__DINGEN_BASE__ = ""')
    expect(out).toContain('rel="manifest"')
  })

  it('sets a prefix and drops the manifest', () => {
    const out = renderIndex(html, '/api/hassio_ingress/abc')
    expect(out).toContain('<base href="/api/hassio_ingress/abc/" />')
    expect(out).toContain('window.__DINGEN_BASE__ = "/api/hassio_ingress/abc"')
    expect(out).not.toContain('rel="manifest"')
  })

  it('never writes an unsafe value', () => {
    const out = renderIndex(html, '/x"</script><script>alert(1)')
    expect(out).toContain('<base href="/" />')
    expect(out).not.toContain('alert')
  })
})

describe('mountWeb', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'dingen-web-'))
  fs.writeFileSync(
    path.join(dir, 'index.html'),
    '<!doctype html><html><head><link rel="manifest" href="./manifest.webmanifest" /></head><body></body></html>',
  )
  fs.mkdirSync(path.join(dir, 'assets'))
  fs.writeFileSync(path.join(dir, 'assets', 'app.js'), 'console.log(1)')
  afterAll(() => fs.rmSync(dir, { recursive: true, force: true }))

  function webApp(ingressPath?: string) {
    const app = new Hono<AppEnv>()
    app.use('*', async (c, next) => {
      c.set('ingressPath', ingressPath)
      await next()
    })
    mountWeb(app, dir)
    return app
  }

  for (const url of ['/', '/index.html', '/today', '/project/abc']) {
    it(`serves index.html with the root base at ${url}`, async () => {
      const res = await webApp().request(url)
      expect(res.status).toBe(200)
      expect(res.headers.get('cache-control')).toBe('no-cache')
      const body = await res.text()
      expect(body).toContain('<base href="/" />')
      expect(body).toContain('window.__DINGEN_BASE__ = ""')
      expect(body).toContain('rel="manifest"')
    })
  }

  it('serves index.html with the ingress base when ingressPath is set', async () => {
    const res = await webApp('/api/hassio_ingress/tok').request('/today')
    expect(res.status).toBe(200)
    expect(res.headers.get('cache-control')).toBe('no-cache')
    const body = await res.text()
    expect(body).toContain('<base href="/api/hassio_ingress/tok/" />')
    expect(body).toContain('window.__DINGEN_BASE__ = "/api/hassio_ingress/tok"')
    expect(body).not.toContain('rel="manifest"')
  })

  it('serves other files as they are, with their cache headers', async () => {
    const res = await webApp('/api/hassio_ingress/tok').request('/assets/app.js')
    expect(res.status).toBe(200)
    expect(await res.text()).toBe('console.log(1)')
    expect(res.headers.get('cache-control')).toContain('immutable')
  })
})
