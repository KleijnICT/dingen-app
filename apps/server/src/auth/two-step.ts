import { randomBytes } from 'node:crypto'
import { APP_NAME } from '@dingen/core'
import { and, count, eq, isNotNull, isNull, lt, or } from 'drizzle-orm'
import { sha256 } from '../agents/service.js'
import type { Db } from '../db.js'
import { totpRecoveryCodes, users } from '../schema.js'
import { AuthError } from './service.js'
import {
  hashRecoveryCode,
  matchTotp,
  newRecoveryCodes,
  newTotpSecret,
  normalizeRecoveryCode,
  otpauthUri,
} from './totp.js'

/** A sign-in waits this long for its code after the password. */
export const CHALLENGE_TTL_MS = 5 * 60 * 1000
/** Wrong codes per sign-in before it has to start over with the password. */
export const CHALLENGE_MAX_ATTEMPTS = 5
/** Wrong codes per account in ATTEMPT_WINDOW_MS before it is locked for a while. */
const MAX_FAILED_CODES = 10
const ATTEMPT_WINDOW_MS = 15 * 60 * 1000

export type ChallengeResult =
  | { ok: true; userId: string; recoveryCodeUsed: boolean }
  | { ok: false; problem: 'invalid_code' | 'challenge_expired' | 'too_many_attempts' }

interface Challenge {
  userId: string
  expiresAt: number
  attempts: number
}

/**
 * Two-step verification with an authenticator app (TOTP, plan 32 decision 3),
 * optional per account. The secret is set up in two steps (show, then confirm
 * with a code) and never leaves the server after that. Ten recovery codes,
 * stored as hashes, each work once. Agents' API tokens and the MCP endpoint
 * do not use it.
 */
export class TwoStepService {
  private readonly challenges = new Map<string, Challenge>()
  private readonly failures = new Map<string, { count: number; firstAt: number }>()

  constructor(private readonly db: Db) {}

  isEnabled(userId: string): boolean {
    const row = this.db
      .select({ on: users.totpEnabledAt })
      .from(users)
      .where(eq(users.id, userId))
      .get()
    return Boolean(row?.on)
  }

  /** Open recovery codes left; 0 when two-step verification is off. */
  recoveryCodesLeft(userId: string): number {
    return (
      this.db
        .select({ n: count() })
        .from(totpRecoveryCodes)
        .where(and(eq(totpRecoveryCodes.userId, userId), isNull(totpRecoveryCodes.usedAt)))
        .get()?.n ?? 0
    )
  }

  /**
   * Starts setting up: a new secret, kept aside until a code confirms it.
   * Returns the secret and the `otpauth://` URI for the QR code, once.
   */
  beginSetup(userId: string, account: string): { secret: string; uri: string } {
    if (this.isEnabled(userId)) throw new AuthError('totp_already_enabled')
    const secret = newTotpSecret()
    this.db.update(users).set({ totpPendingSecret: secret }).where(eq(users.id, userId)).run()
    return { secret, uri: otpauthUri(secret, account, APP_NAME) }
  }

  /**
   * Confirms the setup with a code from the app and turns two-step
   * verification on. Returns the ten recovery codes; they are shown once.
   */
  confirmSetup(userId: string, code: string, now = new Date()): string[] {
    const row = this.db.select().from(users).where(eq(users.id, userId)).get()
    if (!row) throw new AuthError('invalid_credentials')
    if (row.totpEnabledAt) throw new AuthError('totp_already_enabled')
    if (!row.totpPendingSecret) throw new AuthError('totp_not_started')
    this.assertNotLocked(userId)
    const step = matchTotp(row.totpPendingSecret, code, now)
    if (step === null) {
      this.recordFailure(userId)
      throw new AuthError('invalid_code')
    }
    this.failures.delete(userId)
    const codes = newRecoveryCodes()
    const at = now.toISOString()
    this.db.transaction((tx) => {
      tx.update(users)
        .set({
          totpSecret: row.totpPendingSecret,
          totpPendingSecret: null,
          totpEnabledAt: at,
          totpLastStep: step,
        })
        .where(eq(users.id, userId))
        .run()
      tx.delete(totpRecoveryCodes).where(eq(totpRecoveryCodes.userId, userId)).run()
      tx.insert(totpRecoveryCodes)
        .values(codes.map((c) => ({ userId, codeHash: hashRecoveryCode(c), createdAt: at })))
        .run()
    })
    return codes
  }

  /**
   * Checks a 6-digit code or a recovery code for an account with two-step
   * verification on. A code counts once: a TOTP step is not accepted twice
   * and a recovery code is used up. Too many wrong codes lock the account's
   * codes for a while (`too_many_attempts`).
   */
  verify(userId: string, input: string, now = new Date()): 'totp' | 'recovery' | null {
    this.assertNotLocked(userId)
    const row = this.db
      .select({ secret: users.totpSecret, lastStep: users.totpLastStep })
      .from(users)
      .where(and(eq(users.id, userId), isNotNull(users.totpEnabledAt)))
      .get()
    if (!row?.secret) return null
    const step = matchTotp(row.secret, input, now, row.lastStep)
    if (step !== null) {
      // Only if no other request took this step (or a later one) first.
      const taken = this.db
        .update(users)
        .set({ totpLastStep: step })
        .where(
          and(eq(users.id, userId), or(isNull(users.totpLastStep), lt(users.totpLastStep, step))),
        )
        .run()
      if (taken.changes === 1) {
        this.failures.delete(userId)
        return 'totp'
      }
    } else if (normalizeRecoveryCode(input).length === 8) {
      const used = this.db
        .update(totpRecoveryCodes)
        .set({ usedAt: now.toISOString() })
        .where(
          and(
            eq(totpRecoveryCodes.userId, userId),
            eq(totpRecoveryCodes.codeHash, hashRecoveryCode(input)),
            isNull(totpRecoveryCodes.usedAt),
          ),
        )
        .run()
      if (used.changes === 1) {
        this.failures.delete(userId)
        return 'recovery'
      }
    }
    this.recordFailure(userId)
    return null
  }

  /** Turns two-step verification off and removes the secret and recovery codes. */
  disable(userId: string): boolean {
    return this.db.transaction((tx) => {
      const result = tx
        .update(users)
        .set({ totpSecret: null, totpPendingSecret: null, totpEnabledAt: null, totpLastStep: null })
        .where(eq(users.id, userId))
        .run()
      tx.delete(totpRecoveryCodes).where(eq(totpRecoveryCodes.userId, userId)).run()
      return result.changes === 1
    })
  }

  // --- sign-in: password first, then the code ---

  /** After a correct password: a short-lived secret that the code step needs. */
  createChallenge(userId: string, now = Date.now()): string {
    this.pruneChallenges(now)
    const token = randomBytes(32).toString('base64url')
    this.challenges.set(sha256(token), { userId, expiresAt: now + CHALLENGE_TTL_MS, attempts: 0 })
    return token
  }

  /** Finishes a sign-in with the code (or a recovery code); the challenge then is gone. */
  answerChallenge(token: string, code: string, now = new Date()): ChallengeResult {
    const key = sha256(token)
    const challenge = this.challenges.get(key)
    if (!challenge || challenge.expiresAt <= now.getTime()) {
      this.challenges.delete(key)
      return { ok: false, problem: 'challenge_expired' }
    }
    let kind: 'totp' | 'recovery' | null
    try {
      kind = this.verify(challenge.userId, code, now)
    } catch (err) {
      if (err instanceof AuthError && err.code === 'too_many_attempts') {
        this.challenges.delete(key)
        return { ok: false, problem: 'too_many_attempts' }
      }
      throw err
    }
    if (kind) {
      this.challenges.delete(key)
      return { ok: true, userId: challenge.userId, recoveryCodeUsed: kind === 'recovery' }
    }
    challenge.attempts += 1
    if (challenge.attempts >= CHALLENGE_MAX_ATTEMPTS) {
      this.challenges.delete(key)
      return { ok: false, problem: 'too_many_attempts' }
    }
    return { ok: false, problem: 'invalid_code' }
  }

  private pruneChallenges(now: number): void {
    for (const [key, c] of this.challenges) if (c.expiresAt <= now) this.challenges.delete(key)
  }

  private assertNotLocked(userId: string): void {
    const entry = this.failures.get(userId)
    if (!entry) return
    if (Date.now() - entry.firstAt > ATTEMPT_WINDOW_MS) {
      this.failures.delete(userId)
      return
    }
    if (entry.count >= MAX_FAILED_CODES) throw new AuthError('too_many_attempts')
  }

  private recordFailure(userId: string): void {
    const entry = this.failures.get(userId)
    if (!entry || Date.now() - entry.firstAt > ATTEMPT_WINDOW_MS) {
      this.failures.set(userId, { count: 1, firstAt: Date.now() })
    } else {
      entry.count += 1
    }
  }
}
