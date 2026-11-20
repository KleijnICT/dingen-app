import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { createApp } from './app.js'
import { loadConfig, parseMail, parsePublicUrl } from './config.js'
import { type OpenedDatabase, openDatabase } from './db.js'
import { mailLocale } from './mail/messages.js'
import { type MailMessage, MailService } from './mail/service.js'

const SMTP = {
  SMTP_HOST: 'smtp.example.com',
  SMTP_FROM: 'Dingen <dingen@example.com>',
}

describe('mail settings', () => {
  it('is off without a host or a sender', () => {
    expect(parseMail({})).toBeNull()
    expect(parseMail({ SMTP_HOST: 'smtp.example.com' })).toBeNull()
    expect(parseMail({ SMTP_FROM: 'a@example.com' })).toBeNull()
    expect(loadConfig({}, { optionsPath: '/nonexistent/options.json' }).mail).toBeNull()
  })

  it('defaults to port 587 with STARTTLS, and 465 with SMTP_SECURE', () => {
    expect(parseMail(SMTP)).toEqual({
      host: 'smtp.example.com',
      port: 587,
      secure: false,
      user: null,
      password: null,
      from: 'Dingen <dingen@example.com>',
    })
    expect(parseMail({ ...SMTP, SMTP_SECURE: 'true' })).toMatchObject({ port: 465, secure: true })
    expect(parseMail({ ...SMTP, SMTP_PORT: '465' })).toMatchObject({ port: 465, secure: true })
    expect(parseMail({ ...SMTP, SMTP_PORT: '2525', SMTP_SECURE: 'no' })).toMatchObject({
      port: 2525,
      secure: false,
    })
    expect(parseMail({ ...SMTP, SMTP_PORT: 'abc' })).toMatchObject({ port: 587 })
  })

  it('reads the user and password, keeping the password as it is', () => {
    expect(
      parseMail({ ...SMTP, SMTP_USER: ' mailer ', SMTP_PASSWORD: ' secret with spaces ' }),
    ).toMatchObject({ user: 'mailer', password: ' secret with spaces ' })
  })

  it('takes the Home Assistant options before the environment', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'dingen-mail-'))
    try {
      const optionsPath = path.join(dir, 'options.json')
      fs.writeFileSync(
        optionsPath,
        JSON.stringify({
          smtp_host: 'mail.local',
          smtp_port: 25,
          smtp_from: 'ha@example.com',
          smtp_secure: false,
          smtp_user: '',
          smtp_password: 'pw',
          public_url: 'https://ha.example.com/',
        }),
      )
      const config = loadConfig({ ...SMTP, SMTP_USER: 'env-user' }, { optionsPath })
      expect(config.mail).toEqual({
        host: 'mail.local',
        port: 25,
        secure: false,
        user: 'env-user',
        password: 'pw',
        from: 'ha@example.com',
      })
      expect(config.publicUrl).toBe('https://ha.example.com')
    } finally {
      fs.rmSync(dir, { recursive: true, force: true })
    }
  })

  it('accepts only an http(s) public URL, without the trailing slash', () => {
    expect(parsePublicUrl('https://dingen.example.com/')).toBe('https://dingen.example.com')
    expect(parsePublicUrl('http://host:8080/dingen/')).toBe('http://host:8080/dingen')
    expect(parsePublicUrl('ftp://x')).toBeNull()
    expect(parsePublicUrl('not a url')).toBeNull()
    expect(parsePublicUrl('')).toBeNull()
  })

  it('picks Dutch for nl, else English', () => {
    expect(mailLocale('nl')).toBe('nl')
    expect(mailLocale('nl-BE,nl;q=0.9,en;q=0.8')).toBe('nl')
    expect(mailLocale('en-GB,nl;q=0.5')).toBe('en')
    expect(mailLocale(undefined)).toBe('en')
  })
})

describe('mail service', () => {
  it('sends with the configured sender and reports a failure without the password', async () => {
    const sent: (MailMessage & { from: string })[] = []
    const config = parseMail({ ...SMTP, SMTP_USER: 'u', SMTP_PASSWORD: 'hunter2' })
    const ok = new MailService(config, async (m) => {
      sent.push(m)
    })
    await ok.send({ to: 'a@example.com', subject: 'Hi', text: 'Hello' })
    expect(sent).toEqual([
      { to: 'a@example.com', subject: 'Hi', text: 'Hello', from: 'Dingen <dingen@example.com>' },
    ])

    const errors = vi.spyOn(console, 'error').mockImplementation(() => {})
    const broken = new MailService(config, async () => {
      throw new Error('535 Authentication failed')
    })
    await expect(broken.send({ to: 'a@example.com', subject: 'x', text: 'y' })).rejects.toThrow(
      '535 Authentication failed',
    )
    expect(JSON.stringify(errors.mock.calls)).not.toContain('hunter2')
    errors.mockRestore()

    const off = new MailService(null)
    expect(off.isConfigured()).toBe(false)
    await expect(off.send({ to: 'a@example.com', subject: 'x', text: 'y' })).rejects.toThrow(
      'mail_not_configured',
    )
  })
})

describe('admin mail routes', () => {
  const open: OpenedDatabase[] = []
  afterEach(() => {
    for (const d of open.splice(0)) d.close()
  })

  async function setup(withMail: boolean) {
    const database = openDatabase(':memory:')
    open.push(database)
    const outbox: (MailMessage & { from: string })[] = []
    const app = createApp({
      db: database.db,
      version: 'test',
      sqliteVersion: database.sqliteVersion,
      registration: 'open',
      ...(withMail
        ? {
            mail: new MailService(parseMail({ ...SMTP, SMTP_PASSWORD: 'hunter2' }), async (m) => {
              outbox.push(m)
            }),
            publicUrl: 'https://dingen.example.com',
          }
        : {}),
    })
    const call = async (method: string, p: string, cookie = '', body?: unknown) => {
      const res = await app.request(p, {
        method,
        headers: { 'content-type': 'application/json', cookie, 'accept-language': 'nl' },
        body: body === undefined ? undefined : JSON.stringify(body),
      })
      return { status: res.status, body: await res.json(), res }
    }
    const register = async (email: string) => {
      const r = await call('POST', '/api/auth/register', '', { email, password: 'wachtwoord123' })
      return r.res.headers.get('set-cookie')?.split(';')[0] ?? ''
    }
    return { call, register, outbox }
  }

  it('shows the status and sends a test mail to the admin, admins only', async () => {
    const { call, register, outbox } = await setup(true)
    const admin = await register('admin@example.com')
    const other = await register('other@example.com')

    expect((await call('GET', '/api/admin/mail')).status).toBe(401)
    expect((await call('GET', '/api/admin/mail', other)).status).toBe(403)
    expect((await call('POST', '/api/admin/mail/test', other)).status).toBe(403)

    const status = await call('GET', '/api/admin/mail', admin)
    expect(status.body).toEqual({ configured: true, from: 'Dingen <dingen@example.com>' })
    expect(JSON.stringify(status.body)).not.toContain('hunter2')

    const test = await call('POST', '/api/admin/mail/test', admin)
    expect(test.body).toEqual({ ok: true, to: 'admin@example.com' })
    expect(outbox).toHaveLength(1)
    expect(outbox[0]?.to).toBe('admin@example.com')
    expect(outbox[0]?.subject).toBe('Testmail van Dingen')

    const status2 = await call('GET', '/api/auth/status')
    expect(status2.body.passwordReset).toBe(true)
  })

  it('says mail is off without SMTP and hides "Forgot password?"', async () => {
    const { call, register } = await setup(false)
    const admin = await register('admin@example.com')
    expect((await call('GET', '/api/admin/mail', admin)).body).toEqual({
      configured: false,
      from: null,
    })
    expect((await call('POST', '/api/admin/mail/test', admin)).status).toBe(409)
    expect((await call('GET', '/api/auth/status')).body.passwordReset).toBeUndefined()
    expect(
      (await call('POST', '/api/auth/forgot', '', { email: 'admin@example.com' })).status,
    ).toBe(404)
  })
})
