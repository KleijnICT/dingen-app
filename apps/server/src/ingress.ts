import { createMiddleware } from 'hono/factory'
import type { AuthService } from './auth/service.js'
import type { AppEnv } from './env.js'

/** The Home Assistant Supervisor's address on the hassio network; it proxies ingress. */
export const SUPERVISOR_ADDRESS = '172.30.32.2'

const INGRESS_PATH = /^\/api\/hassio_ingress\/[A-Za-z0-9_-]+$/

/** `::ffff:172.30.32.2` → `172.30.32.2`, so IPv4 lists match on dual-stack sockets. */
export function normalizeAddress(address: string): string {
  return address.startsWith('::ffff:') ? address.slice('::ffff:'.length) : address
}

/** A comma-separated address list (DINGEN_INGRESS_TRUSTED); empty → the Supervisor. */
export function parseTrusted(value: string | undefined): string[] {
  const list = (value ?? '')
    .split(',')
    .map((s) => normalizeAddress(s.trim()))
    .filter(Boolean)
  return list.length > 0 ? list : [SUPERVISOR_ADDRESS]
}

/**
 * Home Assistant ingress. Runs only on requests from the ingress listener
 * (`c.env.ingress`); on the normal port it does nothing and the HA headers are
 * ignored. On the ingress listener:
 * - a connection from anywhere but a trusted address (the Supervisor) gets 403;
 * - without `X-Remote-User-Id` the request gets 401;
 * - otherwise the HA user's account is looked up or created and set as
 *   `ingressUser`; `authenticate` then treats it as a session login.
 * A valid `X-Ingress-Path` is set as `ingressPath`.
 */
export function ingressGate(auth: AuthService, trusted: readonly string[]) {
  const allowed = new Set(trusted.map(normalizeAddress))
  return createMiddleware<AppEnv>(async (c, next) => {
    if (!c.env?.ingress) return next()
    const address = c.env.incoming?.socket?.remoteAddress
    if (!address || !allowed.has(normalizeAddress(address))) {
      return c.json({ error: 'forbidden' }, 403)
    }
    const id = c.req.header('x-remote-user-id')?.trim()
    if (!id || id.length > 200) return c.json({ error: 'unauthorized' }, 401)
    const user = auth.homeAssistantUser({
      id,
      name: c.req.header('x-remote-user-name')?.trim() || undefined,
      displayName: c.req.header('x-remote-user-display-name')?.trim() || undefined,
    })
    c.set('ingressUser', user)
    const ingressPath = c.req.header('x-ingress-path')
    if (ingressPath && INGRESS_PATH.test(ingressPath)) c.set('ingressPath', ingressPath)
    await next()
  })
}
