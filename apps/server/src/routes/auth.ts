import { CalendarDate } from '@dingen/core'
import { type Context, Hono } from 'hono'
import { deleteCookie, getCookie, setCookie } from 'hono/cookie'
import { z } from 'zod'
import { requireAuth, requireSession, SESSION_COOKIE } from '../auth/middleware.js'
import type { PasswordResetService } from '../auth/reset.js'
import { AuthError } from '../auth/service.js'
import type { TwoStepService } from '../auth/two-step.js'
import { DEMO_ACCOUNTS, demoAccount } from '../demo/accounts.js'
import type { AppEnv } from '../env.js'
import { mailLocale } from '../mail/messages.js'
import type { MailService } from '../mail/service.js'

const Credentials = z.object({
  email: z.string().email().max(254),
  password: z.string().min(8).max(1024),
})

const NewPassword = z.object({
  /** Required unless the account has no password yet (a Home Assistant account). */
  currentPassword: z.string().min(1).max(1024).optional(),
  password: z.string().min(8).max(1024),
})

const TodaySeen = z.object({ date: CalendarDate })

const Forgot = z.object({
  email: z.string().max(254),
  /** The app's language, for the mail; else the browser's Accept-Language. */
  language: z.string().max(35).optional(),
})

const Reset = z.object({
  token: z.string().min(1).max(200),
  password: z.string().min(8).max(1024),
})

const TwoStepLogin = z.object({
  challenge: z.string().min(1).max(200),
  code: z.string().min(1).max(64),
})

const Code = z.object({ code: z.string().min(1).max(64) })

/** Turning two-step verification off: the password, or a code from the app (or a recovery code). */
const TwoStepOff = z.object({
  password: z.string().min(1).max(1024).optional(),
  code: z.string().min(1).max(64).optional(),
})

const Registration = Credentials.extend({ invite: z.string().min(1).max(200).optional() })

type Ctx = Context<AppEnv>

export function isSecure(c: Ctx): boolean {
  return c.req.url.startsWith('https://') || c.req.header('x-forwarded-proto') === 'https'
}

/** Sleutel voor de login-limiet: het IP achter een eventuele proxy, anders 'local'. */
export function clientKey(c: Ctx): string {
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

/**
 * The address links in mail point to: DINGEN_PUBLIC_URL, else the address
 * this request came in on.
 */
export function appBase(c: Ctx, publicUrl: string | null): string {
  if (publicUrl) return publicUrl
  const url = new URL(c.req.url)
  return `${isSecure(c) ? 'https' : url.protocol.replace(':', '')}://${url.host}`
}

function handleAuthError(c: Ctx, err: unknown) {
  if (err instanceof AuthError) {
    const status =
      err.code === 'too_many_attempts'
        ? 429
        : err.code === 'email_taken' || err.code === 'totp_already_enabled'
          ? 409
          : err.code === 'password_required' ||
              err.code === 'totp_not_started' ||
              err.code === 'invalid_code'
            ? 400
            : err.code.startsWith('invite_')
              ? 403
              : 401
    return c.json({ error: err.code }, status)
  }
  throw err
}

export interface AuthRouteOptions {
  demo?: boolean
  mail: MailService
  resets: PasswordResetService
  twoStep: TwoStepService
  /** DINGEN_PUBLIC_URL, for links in mail. */
  publicUrl?: string | null
}

export function authRoutes(options: AuthRouteOptions) {
  const app = new Hono<AppEnv>()
  const demo = options.demo ?? false
  const { mail, resets, twoStep } = options
  const publicUrl = options.publicUrl ?? null

  app.get('/status', (c) => {
    const auth = c.get('auth')
    return c.json({
      hasUsers: auth.hasUsers(),
      registrationOpen: auth.registrationOpen(),
      registration: auth.registrationMode(),
      // "Forgot password?" only works with mail.
      ...(mail.isConfigured() ? { passwordReset: true } : {}),
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
      // Two-step verification: no session yet, first the code (POST /login/two-step).
      if (twoStep.isEnabled(user.id)) {
        return c.json({ twoStep: true, challenge: twoStep.createChallenge(user.id) })
      }
      startSession(c, user.id)
      return c.json({ user })
    } catch (err) {
      return handleAuthError(c, err)
    }
  })

  // The second step of signing in: the code from the app, or a recovery code.
  app.post('/login/two-step', async (c) => {
    const parsed = TwoStepLogin.safeParse(await c.req.json().catch(() => null))
    if (!parsed.success) return c.json({ error: 'invalid_body', issues: parsed.error.issues }, 400)
    const result = twoStep.answerChallenge(parsed.data.challenge, parsed.data.code)
    if (!result.ok) {
      const status =
        result.problem === 'too_many_attempts' ? 429 : result.problem === 'invalid_code' ? 401 : 410
      return c.json({ error: result.problem }, status)
    }
    const user = c.get('auth').findById(result.userId)
    if (!user) return c.json({ error: 'challenge_expired' }, 410)
    startSession(c, user.id)
    return c.json({
      user,
      ...(result.recoveryCodeUsed ? { recoveryCodesLeft: twoStep.recoveryCodesLeft(user.id) } : {}),
    })
  })

  // "Forgot password?": the same answer whether or not the address has an account.
  app.post('/forgot', async (c) => {
    if (!mail.isConfigured()) return c.json({ error: 'mail_not_configured' }, 404)
    const parsed = Forgot.safeParse(await c.req.json().catch(() => null))
    if (!parsed.success) return c.json({ error: 'invalid_body', issues: parsed.error.issues }, 400)
    const { result } = resets.request(parsed.data.email, {
      clientKey: clientKey(c),
      locale: mailLocale(parsed.data.language ?? c.req.header('accept-language')),
      base: appBase(c, publicUrl),
    })
    if (result === 'limited') return c.json({ error: 'too_many_attempts' }, 429)
    return c.json({ ok: true })
  })

  // Is this reset link (still) usable? Before the "Choose a new password" form.
  app.get('/reset/:token', (c) => {
    const check = resets.check(c.req.param('token'))
    return check.ok
      ? c.json({ ok: true, expiresAt: check.expiresAt })
      : c.json({ error: check.problem }, check.problem === 'reset_invalid' ? 404 : 410)
  })

  // A new password with a reset link; every session of that account is signed out.
  app.post('/reset', async (c) => {
    const parsed = Reset.safeParse(await c.req.json().catch(() => null))
    if (!parsed.success) return c.json({ error: 'invalid_body', issues: parsed.error.issues }, 400)
    const result = await resets.complete(parsed.data.token, parsed.data.password)
    if (result !== 'ok') return c.json({ error: result }, result === 'reset_invalid' ? 404 : 410)
    return c.json({ ok: true })
  })

  // --- two-step verification (Settings → Account) ---

  app.get('/two-step', requireSession, (c) => {
    const userId = c.get('userId')
    return c.json({
      enabled: twoStep.isEnabled(userId),
      recoveryCodesLeft: twoStep.recoveryCodesLeft(userId),
    })
  })

  // Step 1: a new secret and its otpauth:// URI, shown once (QR code and text).
  app.post('/two-step/setup', requireSession, (c) => {
    const user = c.get('user')
    if (!user) return c.json({ error: 'unauthorized' }, 401)
    try {
      return c.json(twoStep.beginSetup(user.id, user.email))
    } catch (err) {
      return handleAuthError(c, err)
    }
  })

  // Step 2: a code from the app turns it on; the recovery codes are shown once.
  app.post('/two-step/enable', requireSession, async (c) => {
    const parsed = Code.safeParse(await c.req.json().catch(() => null))
    if (!parsed.success) return c.json({ error: 'invalid_body', issues: parsed.error.issues }, 400)
    try {
      return c.json({ recoveryCodes: twoStep.confirmSetup(c.get('userId'), parsed.data.code) })
    } catch (err) {
      return handleAuthError(c, err)
    }
  })

  app.post('/two-step/disable', requireSession, async (c) => {
    const parsed = TwoStepOff.safeParse(await c.req.json().catch(() => null))
    if (!parsed.success || (!parsed.data.password && !parsed.data.code)) {
      return c.json({ error: 'invalid_body' }, 400)
    }
    const userId = c.get('userId')
    try {
      const ok = parsed.data.password
        ? await c.get('auth').checkPassword(userId, parsed.data.password)
        : twoStep.verify(userId, parsed.data.code ?? '') !== null
      if (!ok) {
        return c.json({ error: parsed.data.password ? 'invalid_credentials' : 'invalid_code' }, 401)
      }
    } catch (err) {
      return handleAuthError(c, err)
    }
    twoStep.disable(userId)
    return c.json({ ok: true })
  })

  app.post('/logout', (c) => {
    const token = getCookie(c, SESSION_COOKIE)
    if (token) c.get('auth').deleteSession(token)
    deleteCookie(c, SESSION_COOKIE, { path: '/' })
    return c.json({ ok: true })
  })

  // `user.homeAssistant` and `user.hasPassword` describe the account; `ingress`
  // is true when this request came through Home Assistant's ingress port.
  app.get('/me', requireAuth, (c) =>
    c.json({
      user: c.get('user'),
      source: c.get('authSource'),
      member: c.get('actor'),
      ingress: c.get('ingressUser') !== undefined,
    }),
  )

  // OK on Today's "new tasks" banner: seen for this day, on every device.
  app.post('/today-seen', requireAuth, async (c) => {
    const parsed = TodaySeen.safeParse(await c.req.json().catch(() => null))
    if (!parsed.success) return c.json({ error: 'invalid_body', issues: parsed.error.issues }, 400)
    const user = c.get('user')
    if (!user) return c.json({ error: 'unauthorized' }, 401)
    c.get('auth').markTodaySeen(user.id, parsed.data.date)
    return c.json({ ok: true })
  })

  // Change the password, or set the first one for an account without one.
  app.post('/password', requireSession, async (c) => {
    const parsed = NewPassword.safeParse(await c.req.json().catch(() => null))
    if (!parsed.success) return c.json({ error: 'invalid_body', issues: parsed.error.issues }, 400)
    const user = c.get('user')
    if (!user) return c.json({ error: 'unauthorized' }, 401)
    try {
      await c.get('auth').setPassword(user.id, parsed.data.password, parsed.data.currentPassword)
      return c.json({ ok: true })
    } catch (err) {
      return handleAuthError(c, err)
    }
  })

  return app
}
