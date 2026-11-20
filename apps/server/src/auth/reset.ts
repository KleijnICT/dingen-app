import { randomBytes } from 'node:crypto'
import { ulid } from '@dingen/core'
import { and, eq, isNull } from 'drizzle-orm'
import { sha256 } from '../agents/service.js'
import type { Db } from '../db.js'
import { type MailLocale, resetMail } from '../mail/messages.js'
import type { MailService } from '../mail/service.js'
import { passwordResets, sessions, users } from '../schema.js'
import { hashPassword } from './password.js'
import { HA_EMAIL_DOMAIN } from './service.js'

/** A link from "Forgot password?" works for one hour. */
export const RESET_MAIL_TTL_MS = 60 * 60 * 1000
/** A link an administrator makes works for 24 hours. */
export const RESET_ADMIN_TTL_MS = 24 * 60 * 60 * 1000

/** At most this many reset mails per address, and requests per client, per hour. */
export const RESET_PER_ADDRESS = 3
export const RESET_PER_CLIENT = 10
const RESET_WINDOW_MS = 60 * 60 * 1000

/** `account_blocked`: the account was blocked by an administrator; its links do not work. */
export type ResetProblem = 'reset_invalid' | 'reset_expired' | 'reset_used' | 'account_blocked'

type Row = typeof passwordResets.$inferSelect

/** The link for a reset secret: the app's address with `?reset=…`. */
export function resetLink(base: string, token: string): string {
  return `${base.replace(/\/+$/, '')}/?reset=${encodeURIComponent(token)}`
}

function check(
  db: Pick<Db, 'select'>,
  token: string,
  now: Date,
): { ok: true; row: Row } | { ok: false; problem: ResetProblem } {
  const row = db
    .select()
    .from(passwordResets)
    .where(eq(passwordResets.tokenHash, sha256(token)))
    .get()
  if (!row) return { ok: false, problem: 'reset_invalid' }
  if (row.usedAt) return { ok: false, problem: 'reset_used' }
  if (row.expiresAt <= now.toISOString()) return { ok: false, problem: 'reset_expired' }
  const user = db
    .select({ blockedAt: users.blockedAt })
    .from(users)
    .where(eq(users.id, row.userId))
    .get()
  if (!user) return { ok: false, problem: 'reset_invalid' }
  if (user.blockedAt) return { ok: false, problem: 'account_blocked' }
  return { ok: true, row }
}

/**
 * Password resets (plan 32, decision 2): one-time links, by mail or made by an
 * administrator. Only the hash of a link's secret is stored. Using a link sets
 * the password, closes every other open link of that account and signs out
 * all its sessions; agents' API tokens keep working.
 */
export class PasswordResetService {
  private readonly perAddress = new Map<string, number[]>()
  private readonly perClient = new Map<string, number[]>()

  constructor(
    private readonly db: Db,
    private readonly mail: MailService,
  ) {}

  /** Makes a link for an account and returns its secret once. */
  create(
    userId: string,
    options: { createdBy?: string | null; ttlMs?: number; now?: Date } = {},
  ): { token: string; expiresAt: string } {
    const now = options.now ?? new Date()
    const token = randomBytes(32).toString('base64url')
    const expiresAt = new Date(now.getTime() + (options.ttlMs ?? RESET_MAIL_TTL_MS)).toISOString()
    this.db
      .insert(passwordResets)
      .values({
        id: ulid(),
        userId,
        tokenHash: sha256(token),
        createdBy: options.createdBy ?? null,
        createdAt: now.toISOString(),
        expiresAt,
      })
      .run()
    return { token, expiresAt }
  }

  /**
   * A link made by an administrator for `userId` (24 hours), for the admin to
   * pass on by hand; null when there is no such account, `blocked` when the
   * account is blocked (its links would not work).
   */
  createByAdmin(
    userId: string,
    adminId: string,
    now = new Date(),
  ): { token: string; expiresAt: string } | 'blocked' | null {
    const row = this.db
      .select({ blockedAt: users.blockedAt })
      .from(users)
      .where(eq(users.id, userId))
      .get()
    if (!row) return null
    if (row.blockedAt) return 'blocked'
    return this.create(userId, { createdBy: adminId, ttlMs: RESET_ADMIN_TTL_MS, now })
  }

  /** Is this link (still) usable? */
  check(token: string, now = new Date()) {
    const result = check(this.db, token, now)
    return result.ok ? { ok: true as const, expiresAt: result.row.expiresAt } : result
  }

  /**
   * "Forgot password?": mails a link when the address has an account. The
   * answer is the same either way, and the mail goes out after the answer, so
   * neither the reply nor its timing tells whether an address exists. Returns
   * `limited` only for too many requests from one client (that says nothing
   * about the address); `sent` settles when the mail is out (for tests).
   */
  request(
    emailInput: string,
    options: { clientKey: string; locale: MailLocale; base: string; now?: Date },
  ): { result: 'ok' | 'limited'; sent: Promise<void> } {
    const now = options.now ?? new Date()
    const email = emailInput.trim().toLowerCase()
    if (!this.allow(this.perClient, options.clientKey, RESET_PER_CLIENT, now)) {
      return { result: 'limited', sent: Promise.resolve() }
    }
    // Per address: past the limit the answer stays "ok", but nothing is sent.
    if (!this.mail.isConfigured() || !this.allow(this.perAddress, email, RESET_PER_ADDRESS, now)) {
      return { result: 'ok', sent: Promise.resolve() }
    }
    const sent = Promise.resolve().then(async () => {
      const user = this.db
        .select({ id: users.id, email: users.email, blockedAt: users.blockedAt })
        .from(users)
        .where(eq(users.email, email))
        .get()
      // Home Assistant accounts have a placeholder address that never receives mail;
      // a blocked account gets no link (the answer stays the same).
      if (!user || user.blockedAt || user.email.endsWith(`@${HA_EMAIL_DOMAIN}`)) return
      const { token } = this.create(user.id, { now })
      const message = resetMail(options.locale, user.email, resetLink(options.base, token))
      await this.mail.send({ to: user.email, ...message }).catch(() => {
        // Logged by the mail service; the person can ask again.
      })
    })
    return { result: 'ok', sent }
  }

  /** Sets a new password with a link. Signs out every session of the account. */
  async complete(token: string, password: string, now = new Date()): Promise<'ok' | ResetProblem> {
    const first = check(this.db, token, now)
    if (!first.ok) return first.problem
    const passwordHash = await hashPassword(password)
    return this.db.transaction((tx) => {
      // Again inside the transaction: two tabs using one link get one success.
      const result = check(tx, token, now)
      if (!result.ok) return result.problem
      const { userId } = result.row
      const at = now.toISOString()
      tx.update(users).set({ passwordHash }).where(eq(users.id, userId)).run()
      tx.update(passwordResets)
        .set({ usedAt: at })
        .where(and(eq(passwordResets.userId, userId), isNull(passwordResets.usedAt)))
        .run()
      tx.delete(sessions).where(eq(sessions.userId, userId)).run()
      return 'ok' as const
    })
  }

  /** Counts a request under `key`; false when it is over `limit` in the past hour. */
  private allow(store: Map<string, number[]>, key: string, limit: number, now: Date): boolean {
    const t = now.getTime()
    if (store.size > 10_000) {
      for (const [k, times] of store) {
        if (!times.some((at) => t - at < RESET_WINDOW_MS)) store.delete(k)
      }
    }
    const recent = (store.get(key) ?? []).filter((at) => t - at < RESET_WINDOW_MS)
    if (recent.length >= limit) {
      store.set(key, recent)
      return false
    }
    recent.push(t)
    store.set(key, recent)
    return true
  }
}
