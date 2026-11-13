import { describe, expect, it } from 'vitest'
import { keyBytes, pushSupport } from './push.js'

describe('pushSupport', () => {
  const full = {
    isSecureContext: true,
    navigator: { serviceWorker: {} },
    PushManager: class {},
    Notification: class {},
  }

  it('is ok in a secure production build with push', () => {
    expect(pushSupport(full, true)).toBe('ok')
  })

  it('needs HTTPS or localhost', () => {
    expect(pushSupport({ ...full, isSecureContext: false }, true)).toBe('insecure')
  })

  it('is unsupported without a service worker, push or in development', () => {
    expect(pushSupport({ ...full, navigator: {} }, true)).toBe('unsupported')
    expect(pushSupport({ ...full, PushManager: undefined }, true)).toBe('unsupported')
    expect(pushSupport(full, false)).toBe('unsupported')
  })

  it('is off under a path prefix (ingress), also over HTTP', () => {
    expect(pushSupport({ ...full, __DINGEN_BASE__: '/api/hassio_ingress/tok' }, true)).toBe(
      'proxied',
    )
    expect(pushSupport({ __DINGEN_BASE__: '/api/hassio_ingress/tok' }, true)).toBe('proxied')
    expect(pushSupport({ ...full, __DINGEN_BASE__: '' }, true)).toBe('ok')
  })
})

describe('keyBytes', () => {
  it('decodes base64url without padding', () => {
    expect([...keyBytes('AQID-_8')]).toEqual([1, 2, 3, 251, 255])
    expect(keyBytes('AAAAAAAA').length).toBe(6)
  })
})
