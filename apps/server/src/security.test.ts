import { eq } from 'drizzle-orm'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { createApp } from './app.js'
import { PasswordResetService, RESET_PER_ADDRESS } from './auth/reset.js'
import { base32Decode, base32Encode, matchTotp, totpCode, totpStep } from './auth/totp.js'
import { TwoStepService } from './auth/two-step.js'
import { parseMail } from './config.js'
import { type OpenedDatabase, openDatabase } from './db.js'
import { type MailMessage, MailService } from './mail/service.js'
import { passwordResets, sessions, totpRecoveryCodes, users } from './schema.js'

const open: OpenedDatabase[] = []
afterEach(() => {
  vi.useRealTimers()
  for (const d of open.splice(0)) d.close()
})

const SMTP = { SMTP_HOST: 'smtp.example.com', SMTP_FROM: 'dingen@example.com' }

function setup(options: { mail?: boolean } = {}) {
  const database = openDatabase(':memory:')
  open.push(database)
  const outbox: MailMessage[] = []
  const mail = new MailService(options.mail === false ? null : parseMail(SMTP), async (m) => {
    outbox.push(m)
  })
  const app = createApp({
    db: database.db,
    version: 'test',
    sqliteVersion: database.sqliteVersion,
    registration: 'open',
    mail,
    publicUrl: 'https://dingen.example.com',
  })
  async function call(
    method: string,
    p: string,
    body?: unknown,
    headers: Record<string, string> = {},
  ) {
    const res = await app.request(p, {
      method,
      headers: { 'content-type': 'application/json', ...headers },
      body: body === undefined ? undefined : JSON.stringify(body),
    })
    const text = await res.text()
    return {
      res,
      status: res.status,
      body: text ? JSON.parse(text) : null,
      cookie: res.headers.get('set-cookie')?.split(';')[0] ?? '',
    }
  }
  async function register(email: string, password = 'wachtwoord123') {
    const r = await call('POST', '/api/auth/register', { email, password })
    expect(r.status).toBe(201)
    return { id: r.body.user.id as string, cookie: r.cookie }
  }
  const login = (email: string, password = 'wachtwoord123', ip = '10.0.0.1') =>
    call('POST', '/api/auth/login', { email, password }, { 'x-forwarded-for': ip })
  return { db: database.db, app, call, register, login, outbox, mail }
}

/** The token from a reset link in a mail. */
function tokenFrom(text: string): string {
  const match = /\?reset=([\w-]+)/.exec(text)
  if (!match?.[1]) throw new Error(`no reset link in: ${text}`)
  return decodeURIComponent(match[1])
}

describe('totp', () => {
  it('matches the RFC 6238 test vectors (SHA-1, 6 digits)', () => {
    // RFC 6238 appendix B: the secret is ASCII "12345678901234567890".
    const secret = base32Encode(Buffer.from('12345678901234567890'))
    expect(base32Decode(secret).toString()).toBe('12345678901234567890')
    expect(totpCode(secret, totpStep(59_000))).toBe('287082')
    expect(totpCode(secret, totpStep(1_111_111_109_000))).toBe('081804')
    expect(totpCode(secret, totpStep(1_234_567_890_000))).toBe('005924')
    expect(totpCode(secret, totpStep(2_000_000_000_000))).toBe('279037')
  })

  it('accepts one step either side, not two, and not a used step', () => {
    const secret = base32Encode(Buffer.from('12345678901234567890'))
    const now = 1_234_567_890_000
    const step = totpStep(now)
    expect(matchTotp(secret, totpCode(secret, step), now)).toBe(step)
    expect(matchTotp(secret, totpCode(secret, step - 1), now)).toBe(step - 1)
    expect(matchTotp(secret, totpCode(secret, step + 1), now)).toBe(step + 1)
    expect(matchTotp(secret, totpCode(secret, step - 2), now)).toBeNull()
    expect(matchTotp(secret, totpCode(secret, step + 2), now)).toBeNull()
    expect(matchTotp(secret, totpCode(secret, step), now, step)).toBeNull()
    const spaced = totpCode(secret, step).replace(/^(\d{3})/, '$1 ')
    expect(matchTotp(secret, spaced, now)).toBe(step)
    expect(matchTotp(secret, 'abcdef', now)).toBeNull()
  })
})

describe('password reset by mail', () => {
  it('answers the same for an unknown address and mails only a known one', async () => {
    const { call, register, outbox, app } = setup()
    await register('anna@example.com')
    const known = await call('POST', '/api/auth/forgot', { email: 'Anna@Example.com' })
    const unknown = await call('POST', '/api/auth/forgot', { email: 'nobody@example.com' })
    expect(known.status).toBe(200)
    expect(unknown.status).toBe(200)
    expect(known.body).toEqual(unknown.body)
    await vi.waitFor(() => expect(outbox).toHaveLength(1))
    expect(outbox[0]?.to).toBe('anna@example.com')
    expect(outbox[0]?.text).toContain('https://dingen.example.com/?reset=')
    expect(outbox[0]?.subject).toBe('Choose a new password for Dingen')
    void app
  })

  it('writes the mail in Dutch for a Dutch browser or app language', async () => {
    const { call, register, outbox } = setup()
    await register('anna@example.com')
    await call(
      'POST',
      '/api/auth/forgot',
      { email: 'anna@example.com' },
      { 'accept-language': 'nl-NL,nl;q=0.9' },
    )
    await call('POST', '/api/auth/forgot', { email: 'anna@example.com', language: 'nl' })
    await vi.waitFor(() => expect(outbox).toHaveLength(2))
    for (const m of outbox) expect(m.subject).toBe('Kies een nieuw wachtwoord voor Dingen')
  })

  it('sets the new password once, signs out every session and keeps agent tokens', async () => {
    const { call, register, login, outbox, db } = setup()
    const anna = await register('anna@example.com')
    const second = await login('anna@example.com')
    const agent = await call(
      'POST',
      '/api/agents',
      { name: 'Helper', icon: 'bot', color: 'blue', grants: [{ scope: 'all', level: 'read' }] },
      { cookie: anna.cookie },
    )
    expect(agent.status).toBe(201)

    await call('POST', '/api/auth/forgot', { email: 'anna@example.com' })
    await vi.waitFor(() => expect(outbox).toHaveLength(1))
    const token = tokenFrom(outbox[0]?.text ?? '')

    expect((await call('GET', `/api/auth/reset/${token}`)).status).toBe(200)
    const short = await call('POST', '/api/auth/reset', { token, password: 'kort' })
    expect(short.status).toBe(400)
    const done = await call('POST', '/api/auth/reset', { token, password: 'nieuwwachtwoord' })
    expect(done.status).toBe(200)

    // Every session is gone; the agent's token still works.
    expect(db.select().from(sessions).where(eq(sessions.userId, anna.id)).all()).toHaveLength(0)
    expect((await call('GET', '/api/auth/me', undefined, { cookie: anna.cookie })).status).toBe(401)
    expect((await call('GET', '/api/auth/me', undefined, { cookie: second.cookie })).status).toBe(
      401,
    )
    const bearer = { authorization: `Bearer ${agent.body.token}` }
    expect((await call('GET', '/api/sync/snapshot', undefined, bearer)).status).toBe(200)

    // The link works once; the old password no longer, the new one does.
    const again = await call('POST', '/api/auth/reset', { token, password: 'nogeenwachtwoord' })
    expect(again.status).toBe(410)
    expect(again.body.error).toBe('reset_used')
    expect((await call('GET', `/api/auth/reset/${token}`)).body.error).toBe('reset_used')
    expect((await login('anna@example.com')).status).toBe(401)
    expect((await login('anna@example.com', 'nieuwwachtwoord')).status).toBe(200)
  })

  it('refuses an expired or unknown link and stores only a hash', async () => {
    const { call, register, db, mail } = setup()
    const anna = await register('anna@example.com')
    const resets = new PasswordResetService(db, mail)
    const past = new Date(Date.now() - 2 * 60 * 60 * 1000)
    const { token } = resets.create(anna.id, { now: past })
    const rows = db.select().from(passwordResets).all()
    expect(JSON.stringify(rows)).not.toContain(token)

    const expired = await call('POST', '/api/auth/reset', { token, password: 'nieuwwachtwoord' })
    expect(expired.status).toBe(410)
    expect(expired.body.error).toBe('reset_expired')
    const unknown = await call('POST', '/api/auth/reset', {
      token: 'nope',
      password: 'nieuwwachtwoord',
    })
    expect(unknown.status).toBe(404)
    expect(unknown.body.error).toBe('reset_invalid')
  })

  it('limits mails per address silently and requests per client openly', async () => {
    const { call, register, outbox } = setup()
    await register('anna@example.com')
    for (let i = 0; i < RESET_PER_ADDRESS + 2; i++) {
      const r = await call(
        'POST',
        '/api/auth/forgot',
        { email: 'anna@example.com' },
        { 'x-forwarded-for': `10.0.0.${i}` },
      )
      expect(r.status).toBe(200)
    }
    await new Promise((r) => setTimeout(r, 20))
    expect(outbox).toHaveLength(RESET_PER_ADDRESS)

    let limited = 0
    for (let i = 0; i < 12; i++) {
      const r = await call(
        'POST',
        '/api/auth/forgot',
        { email: `x${i}@example.com` },
        { 'x-forwarded-for': '192.168.1.1' },
      )
      if (r.status === 429) limited++
    }
    expect(limited).toBe(2)
  })
})

describe('admin reset link and admin routes', () => {
  it('makes a 24-hour link for the admin to pass on', async () => {
    const { call, register } = setup({ mail: false })
    const admin = await register('admin@example.com')
    const bob = await register('bob@example.com')
    const made = await call('POST', `/api/admin/users/${bob.id}/reset-link`, undefined, {
      cookie: admin.cookie,
    })
    expect(made.status).toBe(201)
    expect(made.body.url).toBe(
      `https://dingen.example.com/?reset=${encodeURIComponent(made.body.token)}`,
    )
    const hours = (Date.parse(made.body.expiresAt) - Date.now()) / 3_600_000
    expect(hours).toBeGreaterThan(23.9)
    expect(hours).toBeLessThanOrEqual(24)

    const done = await call('POST', '/api/auth/reset', {
      token: made.body.token,
      password: 'bobsnieuwe',
    })
    expect(done.status).toBe(200)
    expect((await call('GET', '/api/auth/me', undefined, { cookie: bob.cookie })).status).toBe(401)
    expect(
      (
        await call('POST', '/api/admin/users/nobody/reset-link', undefined, {
          cookie: admin.cookie,
        })
      ).status,
    ).toBe(404)
  })

  it('lets only an admin in a browser session use the admin routes', async () => {
    const { call, register } = setup()
    const admin = await register('admin@example.com')
    const bob = await register('bob@example.com')
    const agent = await call(
      'POST',
      '/api/agents',
      { name: 'Helper', icon: 'bot', color: 'blue', grants: [{ scope: 'all', level: 'manage' }] },
      { cookie: admin.cookie },
    )
    const bearer = { authorization: `Bearer ${agent.body.token}` }
    const routes: [string, string][] = [
      ['GET', '/api/admin/mail'],
      ['POST', '/api/admin/mail/test'],
      ['POST', `/api/admin/users/${admin.id}/reset-link`],
      ['POST', `/api/admin/users/${admin.id}/totp/disable`],
    ]
    for (const [method, p] of routes) {
      expect((await call(method, p)).status).toBe(401)
      expect((await call(method, p, undefined, { cookie: bob.cookie })).status).toBe(403)
      const asAgent = await call(method, p, undefined, bearer)
      expect(asAgent.status).toBe(403)
      expect(asAgent.body.error).toBe('session_required')
    }
  })
})

describe('two-step verification', () => {
  /** Turns it on for the account behind `cookie`; returns the secret and recovery codes. */
  async function enable(call: ReturnType<typeof setup>['call'], cookie: string, now: number) {
    const setupRes = await call('POST', '/api/auth/two-step/setup', undefined, { cookie })
    expect(setupRes.status).toBe(200)
    const { secret, uri } = setupRes.body as { secret: string; uri: string }
    expect(uri).toMatch(/^otpauth:\/\/totp\/Dingen%3A.+\?secret=/)
    const wrong = await call('POST', '/api/auth/two-step/enable', { code: '000000' }, { cookie })
    expect(wrong.status).toBe(400)
    const code = totpCode(secret, totpStep(now))
    const on = await call('POST', '/api/auth/two-step/enable', { code }, { cookie })
    expect(on.status).toBe(200)
    return { secret, recoveryCodes: on.body.recoveryCodes as string[] }
  }

  it('sets up with a QR secret, confirms with a code and gives ten recovery codes', async () => {
    const { call, register, db } = setup()
    const anna = await register('anna@example.com')
    const { recoveryCodes } = await enable(call, anna.cookie, Date.now())
    expect(recoveryCodes).toHaveLength(10)
    expect(new Set(recoveryCodes).size).toBe(10)

    // The secret never comes back, and only hashes of the codes are stored.
    const me = await call('GET', '/api/auth/me', undefined, { cookie: anna.cookie })
    expect(me.body.user.twoStep).toBe(true)
    expect(JSON.stringify(me.body)).not.toMatch(/secret/i)
    const status = await call('GET', '/api/auth/two-step', undefined, { cookie: anna.cookie })
    expect(status.body).toEqual({ enabled: true, recoveryCodesLeft: 10 })
    const again = await call('POST', '/api/auth/two-step/setup', undefined, {
      cookie: anna.cookie,
    })
    expect(again.status).toBe(409)
    const stored = JSON.stringify(db.select().from(totpRecoveryCodes).all())
    for (const code of recoveryCodes) expect(stored).not.toContain(code)
  })

  it('asks for the code after the password, and refuses a reused or wrong one', async () => {
    const { call, register, login } = setup()
    const anna = await register('anna@example.com')
    const now = Date.now()
    const { secret } = await enable(call, anna.cookie, now)

    const first = await login('anna@example.com')
    expect(first.status).toBe(200)
    expect(first.body.twoStep).toBe(true)
    expect(first.body.user).toBeUndefined()
    expect(first.cookie).toBe('')

    // The code that confirmed the setup was used already.
    const reused = await call('POST', '/api/auth/login/two-step', {
      challenge: first.body.challenge,
      code: totpCode(secret, totpStep(now)),
    })
    expect(reused.status).toBe(401)
    expect(reused.body.error).toBe('invalid_code')

    // The next step's code works (a clock one step ahead), once.
    const next = totpCode(secret, totpStep(now) + 1)
    const ok = await call('POST', '/api/auth/login/two-step', {
      challenge: first.body.challenge,
      code: next,
    })
    expect(ok.status).toBe(200)
    expect(ok.cookie).toMatch(/^dingen_session=/)
    expect(ok.body.user.email).toBe('anna@example.com')

    // The challenge is used up, and the same code on a fresh challenge fails.
    const used = await call('POST', '/api/auth/login/two-step', {
      challenge: first.body.challenge,
      code: next,
    })
    expect(used.status).toBe(410)
    const second = await login('anna@example.com')
    const replay = await call('POST', '/api/auth/login/two-step', {
      challenge: second.body.challenge,
      code: next,
    })
    expect(replay.status).toBe(401)
  })

  it('stops a challenge after five wrong codes', async () => {
    const { call, register, login } = setup()
    const anna = await register('anna@example.com')
    await enable(call, anna.cookie, Date.now())
    const { body } = await login('anna@example.com')
    const statuses: number[] = []
    for (let i = 0; i < 6; i++) {
      const r = await call('POST', '/api/auth/login/two-step', {
        challenge: body.challenge,
        code: '000000',
      })
      statuses.push(r.status)
    }
    expect(statuses).toEqual([401, 401, 401, 401, 429, 410])
  })

  it('accepts each recovery code once', async () => {
    const { call, register, login } = setup()
    const anna = await register('anna@example.com')
    const { recoveryCodes } = await enable(call, anna.cookie, Date.now())
    const code = recoveryCodes[0] as string

    const a = await login('anna@example.com')
    const ok = await call('POST', '/api/auth/login/two-step', {
      challenge: a.body.challenge,
      code: ` ${code.toUpperCase().replace('-', ' ')} `,
    })
    expect(ok.status).toBe(200)
    expect(ok.body.recoveryCodesLeft).toBe(9)

    const b = await login('anna@example.com')
    const again = await call('POST', '/api/auth/login/two-step', {
      challenge: b.body.challenge,
      code,
    })
    expect(again.status).toBe(401)
  })

  it('turns off with the password or a code, not with a wrong one', async () => {
    const { call, register, db } = setup()
    const anna = await register('anna@example.com')
    const now = Date.now()
    const { secret, recoveryCodes } = await enable(call, anna.cookie, now)
    const cookie = { cookie: anna.cookie }

    expect((await call('POST', '/api/auth/two-step/disable', {}, cookie)).status).toBe(400)
    const wrongPw = await call('POST', '/api/auth/two-step/disable', { password: 'fout' }, cookie)
    expect(wrongPw.status).toBe(401)
    const wrongCode = await call('POST', '/api/auth/two-step/disable', { code: '000000' }, cookie)
    expect(wrongCode.status).toBe(401)

    const off = await call(
      'POST',
      '/api/auth/two-step/disable',
      { code: totpCode(secret, totpStep(now) + 1) },
      cookie,
    )
    expect(off.status).toBe(200)
    const row = db.select().from(users).where(eq(users.id, anna.id)).get()
    expect(row?.totpSecret).toBeNull()
    expect(row?.totpEnabledAt).toBeNull()
    expect(db.select().from(totpRecoveryCodes).all()).toHaveLength(0)

    // Signing in is one step again; on again, then off with the password.
    const login = await call('POST', '/api/auth/login', {
      email: 'anna@example.com',
      password: 'wachtwoord123',
    })
    expect(login.body.user).toBeDefined()
    await enable(call, anna.cookie, Date.now())
    const offPw = await call(
      'POST',
      '/api/auth/two-step/disable',
      { password: 'wachtwoord123' },
      cookie,
    )
    expect(offPw.status).toBe(200)
    void recoveryCodes
  })

  it('can be turned off by an admin, and leaves agent tokens and the MCP alone', async () => {
    const { call, register, login } = setup()
    const admin = await register('admin@example.com')
    const bob = await register('bob@example.com')
    await enable(call, bob.cookie, Date.now())
    const agent = await call(
      'POST',
      '/api/agents',
      { name: 'Helper', icon: 'bot', color: 'blue', grants: [{ scope: 'all', level: 'read' }] },
      { cookie: bob.cookie },
    )
    const bearer = { authorization: `Bearer ${agent.body.token}` }
    expect((await call('GET', '/api/sync/snapshot', undefined, bearer)).status).toBe(200)

    expect((await login('bob@example.com')).body.twoStep).toBe(true)
    const off = await call('POST', `/api/admin/users/${bob.id}/totp/disable`, undefined, {
      cookie: admin.cookie,
    })
    expect(off.status).toBe(200)
    expect((await login('bob@example.com')).body.user.email).toBe('bob@example.com')
    expect(
      (
        await call('POST', '/api/admin/users/nobody/totp/disable', undefined, {
          cookie: admin.cookie,
        })
      ).status,
    ).toBe(404)
  })

  it('needs a browser session to set up', async () => {
    const { call, register } = setup()
    const anna = await register('anna@example.com')
    const agent = await call(
      'POST',
      '/api/agents',
      { name: 'Helper', icon: 'bot', color: 'blue', grants: [{ scope: 'all', level: 'manage' }] },
      { cookie: anna.cookie },
    )
    const bearer = { authorization: `Bearer ${agent.body.token}` }
    expect((await call('POST', '/api/auth/two-step/setup', undefined, bearer)).status).toBe(403)
  })

  it('locks codes for an account after many wrong ones', () => {
    const database = openDatabase(':memory:')
    open.push(database)
    const service = new TwoStepService(database.db)
    database.db
      .insert(users)
      .values({
        id: 'u1',
        email: 'u@example.com',
        passwordHash: 'x',
        createdAt: new Date().toISOString(),
        totpSecret: base32Encode(Buffer.from('12345678901234567890')),
        totpEnabledAt: new Date().toISOString(),
      })
      .run()
    for (let i = 0; i < 10; i++) expect(service.verify('u1', '000000')).toBeNull()
    expect(() => service.verify('u1', '000000')).toThrow('too_many_attempts')
  })
})

describe('blocked accounts, two-step verification and reset links', () => {
  async function enableTwoStep(call: ReturnType<typeof setup>['call'], cookie: string) {
    const started = await call('POST', '/api/auth/two-step/setup', undefined, { cookie })
    const secret = started.body.secret as string
    const code = totpCode(secret, totpStep(Date.now()))
    expect((await call('POST', '/api/auth/two-step/enable', { code }, { cookie })).status).toBe(200)
    return secret
  }
  const block = (
    call: ReturnType<typeof setup>['call'],
    cookie: string,
    id: string,
    blocked = true,
  ) => call('PATCH', `/api/admin/users/${id}`, { blocked }, { cookie })

  it('lists totpEnabled per user in Administration', async () => {
    const { call, register } = setup()
    const admin = await register('admin@example.com')
    const bob = await register('bob@example.com')
    await enableTwoStep(call, bob.cookie)
    const list = await call('GET', '/api/admin/users', undefined, { cookie: admin.cookie })
    const byEmail = Object.fromEntries(
      (list.body.users as { email: string; totpEnabled: boolean }[]).map((u) => [
        u.email,
        u.totpEnabled,
      ]),
    )
    expect(byEmail).toEqual({ 'admin@example.com': false, 'bob@example.com': true })
    await call('POST', `/api/admin/users/${bob.id}/totp/disable`, undefined, {
      cookie: admin.cookie,
    })
    const after = await call('GET', '/api/admin/users', undefined, { cookie: admin.cookie })
    expect(after.body.users[1].totpEnabled).toBe(false)
  })

  it('refuses a blocked account at the password, before any challenge', async () => {
    const { call, register, login } = setup()
    const admin = await register('admin@example.com')
    const bob = await register('bob@example.com')
    await enableTwoStep(call, bob.cookie)
    expect((await block(call, admin.cookie, bob.id)).status).toBe(200)
    const tried = await login('bob@example.com')
    expect(tried.status).toBe(403)
    expect(tried.body.error).toBe('account_blocked')
    expect(tried.body.challenge).toBeUndefined()
  })

  it('fails a pending two-step challenge once the account is blocked', async () => {
    const { call, register, login } = setup()
    const admin = await register('admin@example.com')
    const bob = await register('bob@example.com')
    const secret = await enableTwoStep(call, bob.cookie)
    const first = await login('bob@example.com')
    expect(first.body.twoStep).toBe(true)

    expect((await block(call, admin.cookie, bob.id)).status).toBe(200)
    const code = totpCode(secret, totpStep(Date.now()) + 1)
    const answer = await call('POST', '/api/auth/login/two-step', {
      challenge: first.body.challenge,
      code,
    })
    expect(answer.status).toBe(403)
    expect(answer.body.error).toBe('account_blocked')
    expect(answer.cookie).toBe('')

    // The challenge is gone, also after unblocking.
    await block(call, admin.cookie, bob.id, false)
    const later = await call('POST', '/api/auth/login/two-step', {
      challenge: first.body.challenge,
      code,
    })
    expect(later.status).toBe(410)
  })

  it('does not let a blocked account use a reset link, nor get a new one', async () => {
    const { call, register, db } = setup({ mail: false })
    const admin = await register('admin@example.com')
    const bob = await register('bob@example.com')
    const made = await call('POST', `/api/admin/users/${bob.id}/reset-link`, undefined, {
      cookie: admin.cookie,
    })
    expect(made.status).toBe(201)
    await block(call, admin.cookie, bob.id)

    const check = await call('GET', `/api/auth/reset/${made.body.token}`)
    expect(check.status).toBe(403)
    expect(check.body.error).toBe('account_blocked')
    const used = await call('POST', '/api/auth/reset', {
      token: made.body.token,
      password: 'bobsnieuwe',
    })
    expect(used.status).toBe(403)
    expect(used.body.error).toBe('account_blocked')
    // The link is not used up.
    const row = db.select().from(passwordResets).where(eq(passwordResets.userId, bob.id)).get()
    expect(row?.usedAt).toBeNull()

    const another = await call('POST', `/api/admin/users/${bob.id}/reset-link`, undefined, {
      cookie: admin.cookie,
    })
    expect(another.status).toBe(409)
    expect(another.body.error).toBe('account_blocked')

    // Unblocked, the old link works again (until it expires).
    await block(call, admin.cookie, bob.id, false)
    const works = await call('POST', '/api/auth/reset', {
      token: made.body.token,
      password: 'bobsnieuwe',
    })
    expect(works.status).toBe(200)
  })

  it('mails no reset link to a blocked account, with the same answer', async () => {
    const { call, register, db, mail, outbox } = setup()
    const admin = await register('admin@example.com')
    const bob = await register('bob@example.com')
    await block(call, admin.cookie, bob.id)
    const resets = new PasswordResetService(db, mail)
    const { result, sent } = resets.request('bob@example.com', {
      clientKey: 'test',
      locale: 'en',
      base: 'https://dingen.example.com',
    })
    await sent
    expect(result).toBe('ok')
    expect(outbox).toHaveLength(0)
    expect(db.select().from(passwordResets).all()).toHaveLength(0)
  })
})
