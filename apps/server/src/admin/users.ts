import { and, count, eq, inArray, isNull, max, ne } from 'drizzle-orm'
import { hasUsablePassword } from '../auth/password.js'
import type { Db } from '../db.js'
import { apiTokens, changes, entities, sessions, spaceMembers, spaces, users } from '../schema.js'

/**
 * Accounts in Administration (plan 32, decision 4): make or unmake an
 * administrator, block and unblock, and delete a blocked account with all
 * its data. An administrator cannot do any of that to themselves, and the
 * last administrator stays one.
 */

export interface AdminUser {
  id: string
  email: string
  createdAt: string
  isAdmin: boolean
  /** When the account was blocked (ISO), or null. */
  blockedAt: string | null
  /** The latest moment a session or an API token of the account was used, or null. */
  lastActiveAt: string | null
  /** Created through Home Assistant. */
  homeAssistant: boolean
  hasPassword: boolean
  // TODO(plan 32, part 1): `totpEnabled` once the users table has a TOTP column.
}

export type AdminProblem =
  | 'not_found'
  /** The administrator acting on their own account. */
  | 'self'
  /** It would leave the server without an (unblocked) administrator. */
  | 'last_admin'
  /** Deleting needs a blocked account. */
  | 'not_blocked'
  /** The confirmation is not the account's e-mail address. */
  | 'confirm_mismatch'
  /** The account owns a shared space that has other members. */
  | 'shared_space'

export class AdminError extends Error {
  constructor(public readonly problem: AdminProblem) {
    super(problem)
  }
}

const later = (a: string | null, b: string | null) => (!a ? b : !b ? a : a > b ? a : b)

export class UserAdmin {
  constructor(private readonly db: Db) {}

  /** Every account, oldest first. */
  list(): AdminUser[] {
    const seen = new Map(
      this.db
        .select({ userId: sessions.userId, at: max(sessions.lastSeenAt) })
        .from(sessions)
        .groupBy(sessions.userId)
        .all()
        .map((r) => [r.userId, r.at]),
    )
    const used = new Map(
      this.db
        .select({ userId: apiTokens.userId, at: max(apiTokens.lastUsedAt) })
        .from(apiTokens)
        .groupBy(apiTokens.userId)
        .all()
        .map((r) => [r.userId, r.at]),
    )
    return this.db
      .select()
      .from(users)
      .orderBy(users.createdAt, users.id)
      .all()
      .map((row) => ({
        id: row.id,
        email: row.email,
        createdAt: row.createdAt,
        isAdmin: row.isAdmin,
        blockedAt: row.blockedAt ?? null,
        lastActiveAt: later(seen.get(row.id) ?? null, used.get(row.id) ?? null),
        homeAssistant: row.haUserId !== null,
        hasPassword: hasUsablePassword(row.passwordHash),
      }))
  }

  get(id: string): AdminUser | null {
    return this.list().find((u) => u.id === id) ?? null
  }

  /** Administrators that are not blocked, other than `except`. */
  private otherAdmins(except: string): number {
    return (
      this.db
        .select({ n: count() })
        .from(users)
        .where(and(eq(users.isAdmin, true), isNull(users.blockedAt), ne(users.id, except)))
        .get()?.n ?? 0
    )
  }

  private row(id: string) {
    const row = this.db.select().from(users).where(eq(users.id, id)).get()
    if (!row) throw new AdminError('not_found')
    return row
  }

  setAdmin(actorId: string, id: string, isAdmin: boolean): AdminUser {
    const row = this.row(id)
    if (!isAdmin && row.isAdmin) {
      if (id === actorId) throw new AdminError('self')
      if (!row.blockedAt && this.otherAdmins(id) === 0) throw new AdminError('last_admin')
    }
    this.db.update(users).set({ isAdmin }).where(eq(users.id, id)).run()
    return this.get(id) as AdminUser
  }

  /**
   * Blocks or unblocks an account. Blocking ends its sessions; its API and
   * agent tokens stay but are refused while it is blocked (see
   * auth/middleware.ts), so unblocking brings its agents back.
   */
  setBlocked(actorId: string, id: string, blocked: boolean, now = new Date()): AdminUser {
    const row = this.row(id)
    if (blocked && !row.blockedAt) {
      if (id === actorId) throw new AdminError('self')
      if (row.isAdmin && this.otherAdmins(id) === 0) throw new AdminError('last_admin')
      this.db.transaction((tx) => {
        tx.update(users).set({ blockedAt: now.toISOString() }).where(eq(users.id, id)).run()
        tx.delete(sessions).where(eq(sessions.userId, id)).run()
      })
    } else if (!blocked && row.blockedAt) {
      this.db.update(users).set({ blockedAt: null }).where(eq(users.id, id)).run()
    }
    return this.get(id) as AdminUser
  }

  /**
   * Checks that the account may be deleted: it exists, is blocked, is not the
   * administrator's own, `confirm` is its e-mail address, and no space it
   * owns has other members. Throws an `AdminError` otherwise.
   */
  checkDelete(actorId: string, id: string, confirm: string): void {
    const row = this.row(id)
    if (id === actorId) throw new AdminError('self')
    if (!row.blockedAt) throw new AdminError('not_blocked')
    if (confirm.trim().toLowerCase() !== row.email.toLowerCase()) {
      throw new AdminError('confirm_mismatch')
    }
    const owned = this.ownedSpaces(this.db, id)
    if (owned.length > 0) {
      const others = this.db
        .select({ n: count() })
        .from(spaceMembers)
        .where(and(inArray(spaceMembers.spaceId, owned), ne(spaceMembers.userId, id)))
        .get()?.n
      if ((others ?? 0) > 0) throw new AdminError('shared_space')
    }
  }

  private ownedSpaces(db: Pick<Db, 'select'>, id: string): string[] {
    return db
      .select({ id: spaces.id })
      .from(spaces)
      .where(eq(spaces.ownerId, id))
      .all()
      .map((r) => r.id)
  }

  /**
   * Deletes the account and everything that is only its own, in one
   * transaction: the entities and change log of the spaces it owns, those
   * spaces and their memberships, and through the foreign keys its sessions,
   * API tokens, agents (with their grants), calendars, push subscriptions,
   * sent reminders and the invitations it made. Changes it made in other
   * people's spaces stay: they belong to those spaces. Call `checkDelete`
   * (and make a back-up) first.
   */
  delete(actorId: string, id: string, confirm: string): { spaces: number; entities: number } {
    this.checkDelete(actorId, id, confirm)
    return this.db.transaction((tx) => {
      const owned = this.ownedSpaces(tx, id)
      let removed = 0
      if (owned.length > 0) {
        removed = tx.delete(entities).where(inArray(entities.spaceId, owned)).run().changes
        tx.delete(changes).where(inArray(changes.spaceId, owned)).run()
        tx.delete(spaceMembers).where(inArray(spaceMembers.spaceId, owned)).run()
        tx.delete(spaces).where(inArray(spaces.id, owned)).run()
      }
      tx.delete(users).where(eq(users.id, id)).run()
      return { spaces: owned.length, entities: removed }
    })
  }
}
