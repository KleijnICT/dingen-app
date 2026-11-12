import { type Context, Hono } from 'hono'
import { deleteCookie, getCookie, setCookie } from 'hono/cookie'
import { z } from 'zod'
import { requireAuth, SESSION_COOKIE } from '../auth/middleware.js'
import { AuthError } from '../auth/service.js'
import { DEMO_ACCOUNTS, demoAccount } from '../demo/accounts.js'
import type { AppEnv } from '../env.js'

const Credentials = z.object({
  email: z.string().email().max(254),
  password: z.string().min(8).max(1024),
})

const Registration = Credentials.extend({ invite: z.string().min(1).max(200).optional() })

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
    const status =
      err.code === 'too_many_attempts'
        ? 429
        : err.code === 'email_taken'
          ? 409
          : err.code.startsWith('invite_')
            ? 403
            : 401
    return c.json({ error: err.code }, status)
  }
  throw err
}

export function authRoutes(options: { demo?: boolean } = {}) {
  const app = new Hono<AppEnv>()
  const demo = options.demo ?? false

  app.get('/status', (c) => {
    const auth = c.get('auth')
    return c.json({
      hasUsers: auth.hasUsers(),
      registrationOpen: auth.registrationOpen(),
      registration: auth.registrationMode(),
      ...(demo ? { demo: true } : {}),
    })
  })

  // Demo mode only: the demo accounts, and signing in as one without a password.
  app.get('/demo', (c) => {
    if (!demo) return c.json({ error: 'not_found' }, 404)
    const auth = c.get('auth')
    return c.json({ accounts: DEMO_ACCOUNTS.filter((a) => auth.findByEmail(a.email)) })
  })

  app.post('/demo/:email', (c) => {
    if (!demo) return c.json({ error: 'not_found' }, 404)
    const account = demoAccount(c.req.param('email'))
    const user = account ? c.get('auth').findByEmail(account.email) : null
    if (!user) return c.json({ error: 'not_found' }, 404)
    startSession(c, user.id)
    return c.json({ user })
  })

  // Controleert een uitnodigingslink voordat iemand het formulier invult.
  app.get('/invite/:token', (c) => {
    const check = c.get('auth').checkInvitation(c.req.param('token'))
    return check.ok
      ? c.json({ ok: true, expiresAt: check.row.expiresAt })
      : c.json({ error: check.problem }, check.problem === 'invite_invalid' ? 404 : 410)
  })

  app.post('/register', async (c) => {
    const parsed = Registration.safeParse(await c.req.json().catch(() => null))
    if (!parsed.success) return c.json({ error: 'invalid_body', issues: parsed.error.issues }, 400)
    try {
      const user = await c
        .get('auth')
        .register(parsed.data.email, parsed.data.password, parsed.data.invite)
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

  app.get('/me', requireAuth, (c) =>
    c.json({ user: c.get('user'), source: c.get('authSource'), member: c.get('actor') }),
  )

  return app
}
