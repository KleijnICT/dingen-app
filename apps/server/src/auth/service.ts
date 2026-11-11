import { createHash, randomBytes } from 'node:crypto'
import { ulid } from '@dingen/core'
import { and, count, desc, eq, gt } from 'drizzle-orm'
import type { RegistrationMode } from '../config.js'
import type { Db } from '../db.js'
import { apiTokens, invitations, sessions, users } from '../schema.js'
import { checkInvitation, type InvitationProblem } from './invitations.js'
import { hashPassword, verifyPassword } from './password.js'

export interface User {
  id: string
  email: string
  createdAt: string
  /** Beheerder van deze installatie (het eerste account). */
  isAdmin: boolean
}

export interface ApiTokenInfo {
  id: string
  name: string
  prefix: string
  createdAt: string
  lastUsedAt: string | null
}

export type AuthSource = 'session' | 'token'

export class AuthError extends Error {
  constructor(
    public readonly code:
      | 'email_taken'
      | 'invalid_credentials'
      | 'registration_closed'
      | 'too_many_attempts'
      | 'invite_required'
      | InvitationProblem,
  ) {
    super(code)
  }
}

export interface AuthOptions {
  /** Wie een account mag maken naast de eerste gebruiker: niemand, iedereen of wie een uitnodiging heeft. */
  registration: RegistrationMode
  sessionTtlMs?: number
}

const SESSION_TTL_MS = 30 * 24 * 60 * 60 * 1000
const TOKEN_PREFIX = 'dgn_'
const MAX_FAILED_ATTEMPTS = 10
const ATTEMPT_WINDOW_MS = 15 * 60 * 1000

function sha256(value: string): string {
  return createHash('sha256').update(value).digest('hex')
}

function normalizeEmail(email: string): string {
  return email.trim().toLowerCase()
}

export class AuthService {
  private readonly failedAttempts = new Map<string, { count: number; firstAt: number }>()
  private readonly sessionTtlMs: number

  constructor(
    private readonly db: Db,
    private readonly options: AuthOptions,
  ) {
    this.sessionTtlMs = options.sessionTtlMs ?? SESSION_TTL_MS
  }

  hasUsers(): boolean {
    const row = this.db.select({ n: count() }).from(users).get()
    return (row?.n ?? 0) > 0
  }

  registrationMode(): RegistrationMode {
    return this.options.registration
  }

  /** Kan iemand zonder uitnodiging nu een account maken? */
  registrationOpen(): boolean {
    return this.options.registration === 'open' || !this.hasUsers()
  }

  /**
   * Maakt een account. Het eerste account kan altijd en wordt beheerder; daarna
   * hangt het af van de stand. Bij `invite` wordt de uitnodiging in dezelfde
   * transactie verbruikt, zodat één link nooit twee accounts oplevert.
   */
  async register(emailInput: string, password: string, invite?: string): Promise<User> {
    const email = normalizeEmail(emailInput)
    // Snel weigeren vóór het (trage) wachtwoord-hashen; de transactie controleert opnieuw.
    this.admit(this.db, email, invite)
    const passwordHash = await hashPassword(password)
    return this.db.transaction((tx) => {
      const { first, invitationId } = this.admit(tx, email, invite)
      const now = new Date().toISOString()
      const user: User = { id: ulid(), email, createdAt: now, isAdmin: first }
      tx.insert(users)
        .values({ ...user, passwordHash })
        .run()
      if (invitationId) {
        tx.update(invitations)
          .set({ usedBy: user.id, usedAt: now })
          .where(eq(invitations.id, invitationId))
          .run()
      }
      return user
    })
  }

  /** Is deze uitnodiging (nog) bruikbaar? */
  checkInvitation(secret: string) {
    return checkInvitation(this.db, secret)
  }

  /** Mag dit account er komen? Gooit een AuthError als dat niet zo is. */
  private admit(
    db: Pick<Db, 'select'>,
    email: string,
    invite: string | undefined,
  ): { first: boolean; invitationId: string | null } {
    const n = db.select({ n: count() }).from(users).get()?.n ?? 0
    const existing = db.select({ id: users.id }).from(users).where(eq(users.email, email)).get()
    if (existing) throw new AuthError('email_taken')
    if (n === 0) return { first: true, invitationId: null }
    switch (this.options.registration) {
      case 'open':
        return { first: false, invitationId: null }
      case 'closed':
        throw new AuthError('registration_closed')
      case 'invite': {
        if (!invite) throw new AuthError('invite_required')
        const check = checkInvitation(db, invite)
        if (!check.ok) throw new AuthError(check.problem)
        return { first: false, invitationId: check.row.id }
      }
    }
  }

  async login(emailInput: string, password: string, clientKey: string): Promise<User> {
    const email = normalizeEmail(emailInput)
    const attemptKey = `${email}|${clientKey}`
    this.assertNotLocked(attemptKey)
    const row = this.db.select().from(users).where(eq(users.email, email)).get()
    const ok = row ? await verifyPassword(password, row.passwordHash) : false
    if (!row || !ok) {
      this.recordFailure(attemptKey)
      throw new AuthError('invalid_credentials')
    }
    this.failedAttempts.delete(attemptKey)
    return { id: row.id, email: row.email, createdAt: row.createdAt, isAdmin: row.isAdmin }
  }

  /** Maakt een sessie en geeft het geheime cookie-token terug (alleen de hash wordt bewaard). */
  createSession(userId: string): { token: string; expiresAt: string } {
    const token = randomBytes(32).toString('base64url')
    const now = new Date()
    const expiresAt = new Date(now.getTime() + this.sessionTtlMs).toISOString()
    this.db
      .insert(sessions)
      .values({
        id: sha256(token),
        userId,
        createdAt: now.toISOString(),
        expiresAt,
        lastSeenAt: now.toISOString(),
      })
      .run()
    return { token, expiresAt }
  }

  resolveSession(token: string): User | null {
    const now = new Date().toISOString()
    const row = this.db
      .select({
        id: users.id,
        email: users.email,
        createdAt: users.createdAt,
        isAdmin: users.isAdmin,
        sessionId: sessions.id,
      })
      .from(sessions)
      .innerJoin(users, eq(users.id, sessions.userId))
      .where(and(eq(sessions.id, sha256(token)), gt(sessions.expiresAt, now)))
      .get()
    if (!row) return null
    this.db.update(sessions).set({ lastSeenAt: now }).where(eq(sessions.id, row.sessionId)).run()
    return { id: row.id, email: row.email, createdAt: row.createdAt, isAdmin: row.isAdmin }
  }

  deleteSession(token: string): void {
    this.db
      .delete(sessions)
      .where(eq(sessions.id, sha256(token)))
      .run()
  }

  createToken(userId: string, name: string): { token: string; info: ApiTokenInfo } {
    const secret = TOKEN_PREFIX + randomBytes(32).toString('base64url')
    const info: ApiTokenInfo = {
      id: ulid(),
      name,
      prefix: secret.slice(0, TOKEN_PREFIX.length + 6),
      createdAt: new Date().toISOString(),
      lastUsedAt: null,
    }
    this.db
      .insert(apiTokens)
      .values({ ...info, userId, tokenHash: sha256(secret) })
      .run()
    return { token: secret, info }
  }

  listTokens(userId: string): ApiTokenInfo[] {
    return this.db
      .select({
        id: apiTokens.id,
        name: apiTokens.name,
        prefix: apiTokens.prefix,
        createdAt: apiTokens.createdAt,
        lastUsedAt: apiTokens.lastUsedAt,
      })
      .from(apiTokens)
      .where(eq(apiTokens.userId, userId))
      .orderBy(desc(apiTokens.createdAt))
      .all()
  }

  deleteToken(userId: string, tokenId: string): boolean {
    const result = this.db
      .delete(apiTokens)
      .where(and(eq(apiTokens.userId, userId), eq(apiTokens.id, tokenId)))
      .run()
    return result.changes > 0
  }

  resolveToken(secret: string): User | null {
    if (!secret.startsWith(TOKEN_PREFIX)) return null
    const row = this.db
      .select({
        id: users.id,
        email: users.email,
        createdAt: users.createdAt,
        isAdmin: users.isAdmin,
        tokenId: apiTokens.id,
      })
      .from(apiTokens)
      .innerJoin(users, eq(users.id, apiTokens.userId))
      .where(eq(apiTokens.tokenHash, sha256(secret)))
      .get()
    if (!row) return null
    this.db
      .update(apiTokens)
      .set({ lastUsedAt: new Date().toISOString() })
      .where(eq(apiTokens.id, row.tokenId))
      .run()
    return { id: row.id, email: row.email, createdAt: row.createdAt, isAdmin: row.isAdmin }
  }

  private assertNotLocked(key: string): void {
    const entry = this.failedAttempts.get(key)
    if (!entry) return
    if (Date.now() - entry.firstAt > ATTEMPT_WINDOW_MS) {
      this.failedAttempts.delete(key)
      return
    }
    if (entry.count >= MAX_FAILED_ATTEMPTS) throw new AuthError('too_many_attempts')
  }

  private recordFailure(key: string): void {
    const entry = this.failedAttempts.get(key)
    if (!entry || Date.now() - entry.firstAt > ATTEMPT_WINDOW_MS) {
      this.failedAttempts.set(key, { count: 1, firstAt: Date.now() })
    } else {
      entry.count += 1
    }
  }
}
