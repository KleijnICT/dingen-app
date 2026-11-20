import { Hono } from 'hono'
import { z } from 'zod'
import { type PasswordResetService, resetLink } from '../auth/reset.js'
import type { TwoStepService } from '../auth/two-step.js'
import type { AppEnv } from '../env.js'
import { mailLocale, testMail } from '../mail/messages.js'
import { MailError, type MailService } from '../mail/service.js'
import { appBase } from './auth.js'

const TestMail = z.object({ language: z.string().max(35).optional() }).optional()

export interface AdminSecurityOptions {
  mail: MailService
  resets: PasswordResetService
  twoStep: TwoStepService
  /** DINGEN_PUBLIC_URL, for the reset link. */
  publicUrl?: string | null
}

/**
 * Administration of mail, password resets and two-step verification (plan
 * 32). Mounted by `adminRoutes` under `/api/admin`, behind its `requireAdmin`.
 */
export function adminSecurityRoutes(options: AdminSecurityOptions) {
  const app = new Hono<AppEnv>()
  const { mail, resets, twoStep } = options

  // Does mail work? No secrets: whether SMTP is set, and the sender.
  app.get('/mail', (c) => c.json({ configured: mail.isConfigured(), from: mail.from() }))

  // A test mail to the administrator's own address.
  app.post('/mail/test', async (c) => {
    const user = c.get('user')
    if (!user) return c.json({ error: 'unauthorized' }, 401)
    if (!mail.isConfigured()) return c.json({ error: 'mail_not_configured' }, 409)
    const body = TestMail.safeParse(await c.req.json().catch(() => undefined))
    const locale = mailLocale(
      (body.success ? body.data?.language : undefined) ?? c.req.header('accept-language'),
    )
    try {
      await mail.send({ to: user.email, ...testMail(locale) })
      return c.json({ ok: true, to: user.email })
    } catch (err) {
      if (err instanceof MailError) return c.json({ error: err.code, detail: err.message }, 502)
      throw err
    }
  })

  // A one-time reset link (24 hours) for the administrator to pass on.
  app.post('/users/:id/reset-link', (c) => {
    const created = resets.createByAdmin(c.req.param('id'), c.get('userId'))
    if (!created) return c.json({ error: 'not_found' }, 404)
    if (created === 'blocked') return c.json({ error: 'account_blocked' }, 409)
    return c.json(
      {
        token: created.token,
        url: resetLink(appBase(c, options.publicUrl ?? null), created.token),
        expiresAt: created.expiresAt,
      },
      201,
    )
  })

  // Turns off another user's (or one's own) two-step verification.
  app.post('/users/:id/totp/disable', (c) => {
    const id = c.req.param('id')
    if (!c.get('auth').findById(id)) return c.json({ error: 'not_found' }, 404)
    twoStep.disable(id)
    return c.json({ ok: true })
  })

  return app
}
