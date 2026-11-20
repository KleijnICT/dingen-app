import { PROTOCOL_HEADER, SYNC_PROTOCOL } from '@dingen/core'

/**
 * Test setup: requests to the sync API speak the current protocol unless the
 * test names one. Every real client sends `x-dingen-protocol` (the web app,
 * the MCP client); the tests about the header itself set it explicitly (an
 * empty value counts as none), see routes/sync.test.ts.
 *
 * `app.request` builds a global `Request`, so a subclass that fills in the
 * header covers every way the tests call the app.
 */
const Base = globalThis.Request

class SpeaksCurrentProtocol extends Base {
  constructor(input: RequestInfo | URL, init?: RequestInit) {
    super(input, init)
    let path = ''
    try {
      path = new URL(this.url).pathname
    } catch {
      return
    }
    if (path.includes('/api/sync/') && !this.headers.has(PROTOCOL_HEADER)) {
      this.headers.set(PROTOCOL_HEADER, String(SYNC_PROTOCOL))
    }
  }
}

globalThis.Request = SpeaksCurrentProtocol
