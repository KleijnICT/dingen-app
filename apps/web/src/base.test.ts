import { afterEach, describe, expect, it, vi } from 'vitest'
import { api } from './api.js'
import { currentBase, readBase, stripBase, underPrefix, withBase } from './base.js'
import { appHref, currentPath, navigate } from './router.js'

const INGRESS = '/api/hassio_ingress/tok'

afterEach(() => {
  vi.unstubAllGlobals()
})

/** A minimal window: the base, an address bar and pushState. */
function fakeWindow(base: string | undefined, pathname: string) {
  const w = {
    __DINGEN_BASE__: base,
    location: { pathname },
    history: {
      pushState: vi.fn((_state: unknown, _title: string, url: string) => {
        w.location.pathname = url
      }),
    },
  }
  vi.stubGlobal('window', w)
  return w
}

describe('readBase', () => {
  it('treats missing, empty and root values as the root', () => {
    expect(readBase(undefined)).toBe('')
    expect(readBase('')).toBe('')
    expect(readBase('/')).toBe('')
  })

  it('keeps a prefix without trailing slash', () => {
    expect(readBase(INGRESS)).toBe(INGRESS)
    expect(readBase(`${INGRESS}/`)).toBe(INGRESS)
  })

  it('ignores anything unexpected', () => {
    expect(readBase('https://evil.example')).toBe('')
    expect(readBase('/a b')).toBe('')
    expect(readBase(42)).toBe('')
  })
})

describe('withBase and stripBase', () => {
  it('leave paths alone without a base', () => {
    expect(withBase('/today', '')).toBe('/today')
    expect(stripBase('/today', '')).toBe('/today')
  })

  it('add and strip a prefix', () => {
    expect(withBase('/today', INGRESS)).toBe(`${INGRESS}/today`)
    expect(withBase('/', INGRESS)).toBe(`${INGRESS}/`)
    expect(stripBase(`${INGRESS}/project/abc`, INGRESS)).toBe('/project/abc')
    expect(stripBase(`${INGRESS}/`, INGRESS)).toBe('/')
    expect(stripBase(INGRESS, INGRESS)).toBe('/')
  })

  it('do not touch other paths', () => {
    expect(withBase('https://example.com/x', INGRESS)).toBe('https://example.com/x')
    expect(stripBase('/other/today', INGRESS)).toBe('/other/today')
    expect(stripBase(`${INGRESS}x/today`, INGRESS)).toBe(`${INGRESS}x/today`)
  })

  it('read the base from the page', () => {
    fakeWindow(INGRESS, '/')
    expect(currentBase()).toBe(INGRESS)
    expect(underPrefix()).toBe(true)
    vi.unstubAllGlobals()
    expect(currentBase()).toBe('')
    expect(underPrefix()).toBe(false)
  })
})

describe('router with and without base', () => {
  it('navigates on plain paths without a base', () => {
    const w = fakeWindow('', '/today')
    navigate('/inbox')
    expect(w.history.pushState).toHaveBeenCalledWith(null, '', '/inbox')
    expect(currentPath()).toBe('/inbox')
    expect(appHref('/inbox')).toBe('/inbox')
  })

  it('adds the base to the address bar and strips it for the app', () => {
    const w = fakeWindow(INGRESS, `${INGRESS}/today`)
    expect(currentPath()).toBe('/today')
    navigate('/project/abc')
    expect(w.history.pushState).toHaveBeenCalledWith(null, '', `${INGRESS}/project/abc`)
    expect(currentPath()).toBe('/project/abc')
    expect(appHref('/review')).toBe(`${INGRESS}/review`)
  })

  it('does not push the same path twice', () => {
    const w = fakeWindow(INGRESS, `${INGRESS}/today`)
    navigate('/today')
    expect(w.history.pushState).not.toHaveBeenCalled()
  })
})

describe('api with and without base', () => {
  function stubFetch() {
    const fetch = vi.fn(async (_url: string, _init?: RequestInit) => Response.json({ ok: true }))
    vi.stubGlobal('fetch', fetch)
    return fetch
  }

  it('calls /api/... as is without a base', async () => {
    const fetch = stubFetch()
    await api.get('/api/auth/status')
    expect(fetch.mock.calls[0]?.[0]).toBe('/api/auth/status')
  })

  it('puts the base in front under a prefix', async () => {
    fakeWindow(INGRESS, `${INGRESS}/today`)
    const fetch = stubFetch()
    await api.post('/api/sync/push', { a: 1 })
    expect(fetch.mock.calls[0]?.[0]).toBe(`${INGRESS}/api/sync/push`)
    expect(fetch.mock.calls[0]?.[1]?.method).toBe('POST')
  })
})
