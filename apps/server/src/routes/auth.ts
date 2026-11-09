import { type Context, Hono } from 'hono'
import { deleteCookie, getCookie, setCookie } from 'hono/cookie'
import { z } from 'zod'
import { requireAuth, SESSION_COOKIE } from '../auth/middleware.js'
import { AuthError } from '../auth/service.js'
import type { AppEnv } from '../env.js'

const Credentials = z.object({
  email: z.string().email().max(254),
  password: z.string().min(8).max(1024),
})

const TokenBody = z.object({ name: z.string().trim().min(1).max(100) })

type Ctx = Context<AppEnv>

function isSecure(c: Ctx): boolean {
  return c.req.url.startsWith('https://') || c.req.header('x-forwarded-proto') === 'https'
}

/** Sleutel voor de login-limiet: het IP achter een eventuele proxy, anders 'local'. */
function clientKey(c: Ctx): string {
  return c.req.header('x-forwarded-for')?.split(',')[0]?.trim() || 'local'
}

function startSession(c: Ctx, userId: string): void {
  const session = c.get('auth').createSession(userId)
  setCookie(c, SESSION_COOKIE, session.token, {
    httpOnly: true,
    sameSite: 'Lax',
    secure: isSecure(c),
    path: '/',
    expires: new Date(session.expiresAt),
  })
}

function handleAuthError(c: Ctx, err: unknown) {
  if (err instanceof AuthError) {
    const status = err.code === 'too_many_attempts' ? 429 : err.code === 'email_taken' ? 409 : 401
    return c.json({ error: err.code }, status)
  }
  throw err
}

export function authRoutes() {
  const app = new Hono<AppEnv>()

  app.get('/status', (c) => {
    const auth = c.get('auth')
    return c.json({ hasUsers: auth.hasUsers(), registrationOpen: auth.registrationOpen() })
  })

  app.post('/register', async (c) => {
    const parsed = Credentials.safeParse(await c.req.json().catch(() => null))
    if (!parsed.success) return c.json({ error: 'invalid_body', issues: parsed.error.issues }, 400)
    try {
      const user = await c.get('auth').register(parsed.data.email, parsed.data.password)
      startSession(c, user.id)
      return c.json({ user }, 201)
    } catch (err) {
      return handleAuthError(c, err)
    }
  })

  app.post('/login', async (c) => {
    const parsed = Credentials.safeParse(await c.req.json().catch(() => null))
    if (!parsed.success) return c.json({ error: 'invalid_body', issues: parsed.error.issues }, 400)
    try {
      const user = await c.get('auth').login(parsed.data.email, parsed.data.password, clientKey(c))
      startSession(c, user.id)
      return c.json({ user })
    } catch (err) {
      return handleAuthError(c, err)
    }
  })

  app.post('/logout', (c) => {
    const token = getCookie(c, SESSION_COOKIE)
    if (token) c.get('auth').deleteSession(token)
    deleteCookie(c, SESSION_COOKIE, { path: '/' })
    return c.json({ ok: true })
  })

  app.get('/me', requireAuth, (c) => c.json({ user: c.get('user'), source: c.get('authSource') }))

  app.get('/tokens', requireAuth, (c) =>
    c.json({ tokens: c.get('auth').listTokens(c.get('userId')) }),
  )

  app.post('/tokens', requireAuth, async (c) => {
    if (c.get('authSource') !== 'session') return c.json({ error: 'session_required' }, 403)
    const parsed = TokenBody.safeParse(await c.req.json().catch(() => null))
    if (!parsed.success) return c.json({ error: 'invalid_body', issues: parsed.error.issues }, 400)
    const { token, info } = c.get('auth').createToken(c.get('userId'), parsed.data.name)
    return c.json({ token, info }, 201)
  })

  app.delete('/tokens/:id', requireAuth, (c) => {
    if (c.get('authSource') !== 'session') return c.json({ error: 'session_required' }, 403)
    const deleted = c.get('auth').deleteToken(c.get('userId'), c.req.param('id'))
    return deleted ? c.json({ ok: true }) : c.json({ error: 'not_found' }, 404)
  })

  return app
}
