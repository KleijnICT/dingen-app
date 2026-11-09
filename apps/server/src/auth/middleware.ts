import { getCookie } from 'hono/cookie'
import { createMiddleware } from 'hono/factory'
import type { AppEnv } from '../env.js'

export const SESSION_COOKIE = 'dingen_session'

/** Zet `user` en `userId` als er een geldige sessiecookie of Bearer-token is; blokkeert niets. */
export const authenticate = createMiddleware<AppEnv>(async (c, next) => {
  const auth = c.get('auth')
  const header = c.req.header('authorization')
  if (header?.startsWith('Bearer ')) {
    const user = auth.resolveToken(header.slice('Bearer '.length).trim())
    if (user) {
      c.set('user', user)
      c.set('userId', user.id)
      c.set('authSource', 'token')
    }
  } else {
    const cookie = getCookie(c, SESSION_COOKIE)
    if (cookie) {
      const user = auth.resolveSession(cookie)
      if (user) {
        c.set('user', user)
        c.set('userId', user.id)
        c.set('authSource', 'session')
      }
    }
  }
  await next()
})

/** Vereist een ingelogde gebruiker; anders 401. */
export const requireAuth = createMiddleware<AppEnv>(async (c, next) => {
  if (!c.get('user')) {
    return c.json({ error: 'unauthorized' }, 401)
  }
  await next()
})
