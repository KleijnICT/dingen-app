import fs from 'node:fs'
import { Readable } from 'node:stream'
import { type Context, Hono } from 'hono'
import { getCookie } from 'hono/cookie'
import { z } from 'zod'
import type { BackupAdmin } from '../admin/backups.js'
import { readRegistration, writeRegistration } from '../admin/registration.js'
import { AdminError, type UserAdmin } from '../admin/users.js'
import { sha256 } from '../agents/service.js'
import { requireAdmin, SESSION_COOKIE } from '../auth/middleware.js'
import type { Db } from '../db.js'
import type { AppEnv } from '../env.js'
import { RestoreError } from '../restore.js'

const UserPatch = z
  .object({ isAdmin: z.boolean().optional(), blocked: z.boolean().optional() })
  .refine((v) => v.isAdmin !== undefined || v.blocked !== undefined, 'nothing to change')

const DeleteBody = z.object({ confirm: z.string().min(1).max(254) })

const RegistrationBody = z.object({ mode: z.enum(['closed', 'open', 'invite']) })

const STATUS: Record<AdminError['problem'], 400 | 404 | 409> = {
  not_found: 404,
  self: 409,
  last_admin: 409,
  not_blocked: 409,
  confirm_mismatch: 400,
  shared_space: 409,
}

export interface AdminRouteDeps {
  db: Db
  users: UserAdmin
  /** Absent when the server has no back-up directory (tests); the routes then 404. */
  backups?: BackupAdmin
  /** Mail, reset links and two-step verification (routes/admin-security.ts), behind the same guard. */
  security?: Hono<AppEnv>
}

/**
 * Administration (plan 32): everything under /api/admin, only for an
 * administrator in a browser session (or Home Assistant ingress). Agent and
 * API tokens get 403, also with an `all` grant: a leaked token must not be
 * able to manage accounts or restore the server.
 */
export function adminRoutes(deps: AdminRouteDeps) {
  const app = new Hono<AppEnv>()
  const { users, backups } = deps

  app.use('*', requireAdmin)
  if (deps.security) app.route('/', deps.security)

  const fail = (c: Context<AppEnv>, err: unknown) => {
    if (err instanceof AdminError) return c.json({ error: err.problem }, STATUS[err.problem])
    throw err
  }

  // --- users ---

  app.get('/users', (c) => c.json({ users: users.list() }))

  app.patch('/users/:id', async (c) => {
    const parsed = UserPatch.safeParse(await c.req.json().catch(() => null))
    if (!parsed.success) return c.json({ error: 'invalid_body', issues: parsed.error.issues }, 400)
    const actor = c.get('userId')
    const id = c.req.param('id')
    try {
      let user = users.get(id)
      if (!user) return c.json({ error: 'not_found' }, 404)
      if (parsed.data.blocked !== undefined) user = users.setBlocked(actor, id, parsed.data.blocked)
      if (parsed.data.isAdmin !== undefined) user = users.setAdmin(actor, id, parsed.data.isAdmin)
      return c.json({ user })
    } catch (err) {
      return fail(c, err)
    }
  })

  // Deletes a blocked account with all its data, after a back-up.
  app.delete('/users/:id', async (c) => {
    const parsed = DeleteBody.safeParse(await c.req.json().catch(() => null))
    if (!parsed.success) return c.json({ error: 'invalid_body', issues: parsed.error.issues }, 400)
    const actor = c.get('userId')
    const id = c.req.param('id')
    try {
      users.checkDelete(actor, id, parsed.data.confirm)
      const backup = backups ? await backups.create('pre-delete') : null
      const removed = users.delete(actor, id, parsed.data.confirm)
      return c.json({ ok: true, backup: backup?.name ?? null, ...removed })
    } catch (err) {
      return fail(c, err)
    }
  })

  // --- registration ---

  app.get('/registration', (c) => c.json({ mode: readRegistration(deps.db) }))

  app.put('/registration', async (c) => {
    const parsed = RegistrationBody.safeParse(await c.req.json().catch(() => null))
    if (!parsed.success) return c.json({ error: 'invalid_body', issues: parsed.error.issues }, 400)
    writeRegistration(deps.db, parsed.data.mode)
    return c.json({ mode: parsed.data.mode })
  })

  // --- back-ups ---

  app.use('/backups', async (c, next) => {
    if (!backups) return c.json({ error: 'not_found' }, 404)
    await next()
  })
  app.use('/backups/*', async (c, next) => {
    if (!backups) return c.json({ error: 'not_found' }, 404)
    await next()
  })

  app.get('/backups', (c) =>
    c.json({ backups: backups?.list() ?? [], canRestore: backups?.canRestore ?? false }),
  )

  app.post('/backups', async (c) => {
    if (!backups) return c.json({ error: 'not_found' }, 404)
    return c.json({ backup: await backups.create('manual') }, 201)
  })

  // The file itself, streamed.
  app.get('/backups/:name', (c) => {
    const name = c.req.param('name')
    const file = backups?.file(name)
    if (!file) return c.json({ error: 'not_found' }, 404)
    const size = fs.statSync(file).size
    const stream = Readable.toWeb(fs.createReadStream(file)) as ReadableStream<Uint8Array>
    return c.body(stream, 200, {
      'content-type': 'application/vnd.sqlite3',
      'content-length': String(size),
      'content-disposition': `attachment; filename="${name}"`,
      'cache-control': 'no-store',
    })
  })

  // Puts a back-up back: first a back-up of the current state, then the swap and restart.
  app.post('/backups/:name/restore', async (c) => {
    if (!backups) return c.json({ error: 'not_found' }, 404)
    if (!backups.canRestore) return c.json({ error: 'not_found' }, 404)
    const name = c.req.param('name')
    if (!backups.file(name)) return c.json({ error: 'not_found' }, 404)
    const cookie = getCookie(c, SESSION_COOKIE)
    const keep = cookie ? { id: sha256(cookie), userId: c.get('userId') } : null
    try {
      const { saved, run } = await backups.prepareRestore(name, keep)
      // After the response has gone out: the swap closes the database under this request.
      setTimeout(run, 50)
      return c.json({ ok: true, saved: saved.name }, 202)
    } catch (err) {
      if (err instanceof RestoreError) {
        return c.json({ error: 'invalid_backup', issues: [err.message] }, 422)
      }
      throw err
    }
  })

  return app
}
