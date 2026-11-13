import type { Context } from 'hono'
import { getCookie } from 'hono/cookie'
import { createMiddleware } from 'hono/factory'
import type { Access } from '../agents/access.js'
import { hasAll } from '../agents/access.js'
import type { AppEnv } from '../env.js'
import type { User } from './service.js'

export const SESSION_COOKIE = 'dingen_session'

/**
 * Zet `user`, `userId`, `actor` en `grants` als er een geldige sessiecookie of
 * agent-token is; blokkeert niets. A revoked agent's token resolves to nobody.
 * On the Home Assistant ingress listener the HA user (`ingressUser`, see
 * ingress.ts) signs in as the owner, exactly like a session; cookies and
 * tokens are not used there.
 */
export const authenticate = createMiddleware<AppEnv>(async (c, next) => {
  const auth = c.get('auth')
  const header = c.req.header('authorization')
  const ingressUser = c.get('ingressUser')
  if (ingressUser) {
    setSessionUser(c, ingressUser)
  } else if (header?.startsWith('Bearer ')) {
    const resolved = c.get('agents').resolveToken(header.slice('Bearer '.length).trim())
    const user = resolved ? auth.findById(resolved.userId) : null
    if (resolved && user) {
      c.set('user', user)
      c.set('userId', user.id)
      c.set('authSource', 'token')
      c.set('actor', `agent:${resolved.agentId}`)
      c.set('grants', resolved.grants)
      c.set('agentId', resolved.agentId)
    }
  } else {
    const cookie = getCookie(c, SESSION_COOKIE)
    if (cookie) {
      const user = auth.resolveSession(cookie)
      if (user) setSessionUser(c, user)
    }
  }
  await next()
})

/** The owner acts: a browser session (or Home Assistant ingress). */
function setSessionUser(c: Context<AppEnv>, user: User): void {
  c.set('user', user)
  c.set('userId', user.id)
  c.set('authSource', 'session')
  c.set('actor', `user:${user.id}`)
  c.set('grants', null)
  c.set('agentId', null)
}

/** Vereist een ingelogde gebruiker; anders 401. */
export const requireAuth = createMiddleware<AppEnv>(async (c, next) => {
  if (!c.get('user')) {
    return c.json({ error: 'unauthorized' }, 401)
  }
  await next()
})

/** Only a browser session, not an agent token; 403 `session_required` otherwise. */
export const requireSession = createMiddleware<AppEnv>(async (c, next) => {
  if (!c.get('user')) return c.json({ error: 'unauthorized' }, 401)
  if (c.get('authSource') !== 'session') return c.json({ error: 'session_required' }, 403)
  await next()
})

/**
 * Account-wide endpoints (sync, export, calendars, …): the owner, or an agent
 * with an `all` grant of at least `level`; others get 403 `agent_scope`.
 */
export function requireAllScope(level: 'read' | 'edit' | 'manage' = 'read') {
  return createMiddleware<AppEnv>(async (c, next) => {
    if (!c.get('user')) return c.json({ error: 'unauthorized' }, 401)
    if (!hasAll(c.get('grants'), level)) return c.json({ error: 'agent_scope' }, 403)
    await next()
  })
}

/** The access of the current request. */
export function accessOf(c: Context<AppEnv>): Access {
  return { userId: c.get('userId'), actor: c.get('actor'), grants: c.get('grants') }
}
